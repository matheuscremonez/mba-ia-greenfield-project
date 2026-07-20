import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { StorageUnavailableException } from '../exceptions/video.exceptions';
import { VideoStorageService } from './video-storage.service';

function getMockCall<T extends unknown[]>(mock: jest.Mock, index: number): T {
  const calls = mock.mock.calls as unknown as unknown[][];
  return calls[index] as T;
}

describe('VideoStorageService', () => {
  const config: ConfigType<typeof storageConfig> = {
    internalEndpoint: 'http://minio:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'streamtube',
    secretAccessKey: 'streamtube-secret',
    sourceBucket: 'streamtube-videos',
    thumbnailBucket: 'streamtube-thumbnails',
    forcePathStyle: true,
    signedUrlExpiresInSeconds: 900,
    partSizeBytes: 67_108_864,
  };

  let internalSend: jest.Mock;
  let publicSend: jest.Mock;
  let signer: jest.Mock;
  let service: VideoStorageService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T15:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    internalSend = jest.fn();
    publicSend = jest.fn();
    signer = jest.fn();
    service = new VideoStorageService(
      { send: internalSend } as unknown as S3Client,
      { send: publicSend } as unknown as S3Client,
      signer as unknown as typeof getSignedUrl,
      config,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('creates a fixed-size multipart descriptor for a 10 GiB source', async () => {
    internalSend.mockResolvedValue({ UploadId: 'upload-1' });

    const result = await service.createMultipartUpload(
      'sources/video-id/original.mp4',
      'video/mp4',
      10 * 1024 * 1024 * 1024,
    );

    expect(internalSend).toHaveBeenCalledWith(
      expect.any(CreateMultipartUploadCommand),
    );
    const [command] = getMockCall<[CreateMultipartUploadCommand]>(
      internalSend,
      0,
    );
    expect(command.input).toEqual({
      Bucket: 'streamtube-videos',
      Key: 'sources/video-id/original.mp4',
      ContentType: 'video/mp4',
    });
    expect(result).toEqual({
      uploadId: 'upload-1',
      partSizeBytes: 67_108_864,
      partCount: 160,
      expiresAt: new Date('2026-07-20T15:15:00.000Z'),
    });
  });

  it('signs only the requested distinct upload parts for 900 seconds', async () => {
    signer
      .mockResolvedValueOnce('http://localhost:9000/part-3')
      .mockResolvedValueOnce('http://localhost:9000/part-7');

    const result = await service.signUploadParts(
      'source-key',
      'upload-1',
      [3, 7],
    );

    expect(signer).toHaveBeenCalledTimes(2);
    for (const [callIndex, partNumber] of [3, 7].entries()) {
      const [client, command, options] = getMockCall<
        [S3Client, UploadPartCommand, { expiresIn: number }]
      >(signer, callIndex);
      expect(client).toEqual({ send: publicSend });
      expect(command).toBeInstanceOf(UploadPartCommand);
      expect(command.input).toEqual({
        Bucket: 'streamtube-videos',
        Key: 'source-key',
        UploadId: 'upload-1',
        PartNumber: partNumber,
      });
      expect(options).toEqual({ expiresIn: 900 });
    }
    expect(result.map(({ partNumber, url }) => ({ partNumber, url }))).toEqual([
      { partNumber: 3, url: 'http://localhost:9000/part-3' },
      { partNumber: 7, url: 'http://localhost:9000/part-7' },
    ]);
  });

  it('rejects empty, duplicate or oversized signing batches before the SDK', async () => {
    await expect(service.signUploadParts('key', 'upload', [])).rejects.toThrow(
      RangeError,
    );
    await expect(
      service.signUploadParts('key', 'upload', [1, 1]),
    ).rejects.toThrow(RangeError);
    await expect(
      service.signUploadParts(
        'key',
        'upload',
        Array.from({ length: 21 }, (_, index) => index + 1),
      ),
    ).rejects.toThrow(RangeError);
    expect(signer).not.toHaveBeenCalled();
  });

  it('sorts completion parts and maps head metadata to domain types', async () => {
    internalSend.mockResolvedValueOnce({}).mockResolvedValueOnce({
      ContentLength: 123,
      ContentType: 'video/mp4',
      ETag: 'etag-source',
    });

    await service.completeMultipartUpload('source-key', 'upload-1', [
      { partNumber: 2, etag: 'etag-2' },
      { partNumber: 1, etag: 'etag-1' },
    ]);
    const result = await service.headSource('source-key');

    const [complete] = getMockCall<[CompleteMultipartUploadCommand]>(
      internalSend,
      0,
    );
    expect(complete.input.MultipartUpload?.Parts).toEqual([
      { PartNumber: 1, ETag: 'etag-1' },
      { PartNumber: 2, ETag: 'etag-2' },
    ]);
    const [head] = getMockCall<[HeadObjectCommand]>(internalSend, 1);
    expect(head).toBeInstanceOf(HeadObjectCommand);
    expect(result).toEqual({
      contentLength: 123,
      contentType: 'video/mp4',
      etag: 'etag-source',
    });
  });

  it('uses private buckets for worker transfer and idempotent deletion commands', async () => {
    const sourceStream = Readable.from([Buffer.from('video')]);
    internalSend
      .mockResolvedValueOnce({ Body: sourceStream })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    await expect(service.downloadSource('source-key')).resolves.toBe(
      sourceStream,
    );
    await service.uploadThumbnail(
      'thumbnail-key',
      new Uint8Array([1, 2, 3]),
      3,
    );
    await service.deleteSource('source-key');
    await service.deleteThumbnail('thumbnail-key');

    const [thumbnail] = getMockCall<[PutObjectCommand]>(internalSend, 1);
    expect(thumbnail.input).toMatchObject({
      Bucket: 'streamtube-thumbnails',
      Key: 'thumbnail-key',
      ContentLength: 3,
      ContentType: 'image/jpeg',
    });
    const [sourceDelete] = getMockCall<[DeleteObjectCommand]>(internalSend, 2);
    const [thumbnailDelete] = getMockCall<[DeleteObjectCommand]>(
      internalSend,
      3,
    );
    expect(sourceDelete).toEqual(expect.any(DeleteObjectCommand));
    expect(thumbnailDelete).toEqual(expect.any(DeleteObjectCommand));
  });

  it('signs private reads and sanitizes the attachment filename', async () => {
    signer
      .mockResolvedValueOnce('http://localhost:9000/thumbnail')
      .mockResolvedValueOnce('http://localhost:9000/stream')
      .mockResolvedValueOnce('http://localhost:9000/download');

    await service.signThumbnail('thumbnail-key');
    await service.signStream('source-key');
    const download = await service.signDownload(
      'source-key',
      '../Meu v\u00eddeo\r\n.mp4',
    );

    const [, thumbnail] = getMockCall<[S3Client, GetObjectCommand]>(signer, 0);
    const [, stream] = getMockCall<[S3Client, GetObjectCommand]>(signer, 1);
    const [, attachment] = getMockCall<[S3Client, GetObjectCommand]>(signer, 2);
    expect(thumbnail.input).toMatchObject({
      Bucket: 'streamtube-thumbnails',
      ResponseContentType: 'image/jpeg',
    });
    expect(stream.input).toEqual({
      Bucket: 'streamtube-videos',
      Key: 'source-key',
    });
    expect(attachment.input.ResponseContentDisposition).toBe(
      'attachment; filename="Meu_vi_deo_.mp4"',
    );
    expect(download.expiresAt).toEqual(new Date('2026-07-20T15:15:00.000Z'));
  });

  it('translates provider failures without exposing their message', async () => {
    internalSend.mockRejectedValue(
      new Error('Access key streamtube-secret rejected for secret-bucket'),
    );

    const promise = service.headSource('private/source-key');

    await expect(promise).rejects.toBeInstanceOf(StorageUnavailableException);
    await expect(promise).rejects.toMatchObject({
      errorCode: 'STORAGE_UNAVAILABLE',
      httpStatus: 503,
      message: 'Video storage is temporarily unavailable',
    });
  });
});
