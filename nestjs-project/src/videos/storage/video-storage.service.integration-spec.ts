import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { videoStorageProviders } from './video-storage.providers';
import { VideoStorageService } from './video-storage.service';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      throw new TypeError('Unexpected stream chunk');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('VideoStorageService (MinIO integration)', () => {
  let module: TestingModule;
  let service: VideoStorageService;
  let originalPublicEndpoint: string | undefined;
  const sourceKeys = new Set<string>();
  const thumbnailKeys = new Set<string>();

  beforeAll(async () => {
    originalPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
    process.env.S3_PUBLIC_ENDPOINT = process.env.S3_INTERNAL_ENDPOINT;

    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ load: [storageConfig] })],
      providers: [...videoStorageProviders, VideoStorageService],
    }).compile();
    service = module.get(VideoStorageService);
  });

  afterEach(async () => {
    await Promise.all([
      ...[...sourceKeys].map((key) => service.deleteSource(key)),
      ...[...thumbnailKeys].map((key) => service.deleteThumbnail(key)),
    ]);
    sourceKeys.clear();
    thumbnailKeys.clear();
  });

  afterAll(async () => {
    await module.close();
    if (originalPublicEndpoint === undefined) {
      delete process.env.S3_PUBLIC_ENDPOINT;
    } else {
      process.env.S3_PUBLIC_ENDPOINT = originalPublicEndpoint;
    }
  });

  it('keeps objects private while signed reads support ranges and attachments', async () => {
    const id = randomUUID();
    const sourceKey = `integration/${id}/source.mp4`;
    const thumbnailKey = `integration/${id}/thumbnail.jpg`;
    const payload = Buffer.from('hello-video');
    sourceKeys.add(sourceKey);
    thumbnailKeys.add(thumbnailKey);

    const multipart = await service.createMultipartUpload(
      sourceKey,
      'video/mp4',
      payload.length,
    );
    const [part] = await service.signUploadParts(
      sourceKey,
      multipart.uploadId,
      [1],
    );
    const uploadResponse = await fetch(part.url, {
      method: 'PUT',
      body: new Uint8Array(payload),
    });
    expect(uploadResponse.status).toBe(200);
    const etag = uploadResponse.headers.get('etag');
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(sourceKey, multipart.uploadId, [
      { partNumber: 1, etag: etag! },
    ]);
    await expect(service.headSource(sourceKey)).resolves.toMatchObject({
      contentLength: payload.length,
      contentType: 'video/mp4',
    });

    const anonymousUrl = `${process.env.S3_INTERNAL_ENDPOINT}/${process.env.S3_SOURCE_BUCKET}/${sourceKey}`;
    expect((await fetch(anonymousUrl)).status).toBe(403);

    const streamUrl = await service.signStream(sourceKey);
    const fullResponse = await fetch(streamUrl.url);
    expect(fullResponse.status).toBe(200);
    expect(Buffer.from(await fullResponse.arrayBuffer())).toEqual(payload);

    const rangeResponse = await fetch(streamUrl.url, {
      headers: { Range: 'bytes=1-3' },
    });
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get('accept-ranges')).toBe('bytes');
    expect(rangeResponse.headers.get('content-range')).toBe(
      `bytes 1-3/${payload.length}`,
    );
    expect(Buffer.from(await rangeResponse.arrayBuffer())).toEqual(
      payload.subarray(1, 4),
    );

    const downloadUrl = await service.signDownload(
      sourceKey,
      '../unsafe name.mp4',
    );
    const downloadResponse = await fetch(downloadUrl.url);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="unsafe_name.mp4"',
    );

    const workerStream = await service.downloadSource(sourceKey);
    await expect(streamToBuffer(workerStream)).resolves.toEqual(payload);

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await service.uploadThumbnail(thumbnailKey, jpeg, jpeg.byteLength);
    const thumbnailUrl = await service.signThumbnail(thumbnailKey);
    const thumbnailResponse = await fetch(thumbnailUrl.url);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await thumbnailResponse.arrayBuffer())).toEqual(jpeg);
  });

  it('aborts an unfinished multipart upload', async () => {
    const sourceKey = `integration/${randomUUID()}/aborted.mp4`;
    sourceKeys.add(sourceKey);
    const multipart = await service.createMultipartUpload(
      sourceKey,
      'video/mp4',
      1024,
    );
    const [part] = await service.signUploadParts(
      sourceKey,
      multipart.uploadId,
      [1],
    );

    await service.abortMultipartUpload(sourceKey, multipart.uploadId);

    const response = await fetch(part.url, {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(404);
  });
});
