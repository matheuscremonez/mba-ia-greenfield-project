import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStorageService } from '../src/videos/storage/video-storage.service';
import { VideoStatus } from '../src/videos/video-status.enum';

describe('Video media access (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let jwt: JwtService;
  let storage: VideoStorageService;
  let throttler: ThrottlerStorageService;
  let originalPublicEndpoint: string | undefined;

  beforeAll(async () => {
    originalPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
    process.env.S3_PUBLIC_ENDPOINT = process.env.S3_INTERNAL_ENDPOINT;
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();
    dataSource = fixture.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    jwt = fixture.get(JwtService);
    storage = fixture.get(VideoStorageService);
    throttler = fixture.get(ThrottlerStorage);
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttler.storage.clear();
  });

  afterEach(async () => {
    for (const video of await videos.find()) {
      await storage.deleteSource(video.source_key);
      if (video.thumbnail_key) {
        await storage.deleteThumbnail(video.thumbnail_key);
      }
    }
    await cleanAllTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
    if (originalPublicEndpoint === undefined) {
      delete process.env.S3_PUBLIC_ENDPOINT;
    } else {
      process.env.S3_PUBLIC_ENDPOINT = originalPublicEndpoint;
    }
  });

  async function createOwner(
    suffix: string,
  ): Promise<{ user: User; channel: Channel; token: string }> {
    const user = await users.save(
      users.create({ email: `${suffix}@example.com`, password: 'hashed' }),
    );
    const channel = await channels.save(
      channels.create({ name: suffix, nickname: suffix, user_id: user.id }),
    );
    return {
      user,
      channel,
      token: await jwt.signAsync({ sub: user.id, email: user.email }),
    };
  }

  async function putSource(key: string, body: Buffer): Promise<void> {
    const upload = await storage.createMultipartUpload(
      key,
      'video/mp4',
      body.byteLength,
    );
    const [part] = await storage.signUploadParts(key, upload.uploadId, [1]);
    const payload = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
    const response = await fetch(part.url, { method: 'PUT', body: payload });
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    await storage.completeMultipartUpload(key, upload.uploadId, [
      { partNumber: 1, etag: etag! },
    ]);
  }

  async function createVideo(
    channel: Channel,
    status: VideoStatus,
  ): Promise<{ video: Video; source: Buffer }> {
    const source = Buffer.from('streamable-video-source');
    const id = randomUUID();
    const sourceKey = `videos/${id}/source`;
    const thumbnailKey = `thumbnails/${id}/default.jpg`;
    if (status === VideoStatus.READY) {
      await putSource(sourceKey, source);
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      await storage.uploadThumbnail(thumbnailKey, jpeg, jpeg.byteLength);
    }
    const video = await videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        title: 'Private video',
        original_filename: '../private video.mp4',
        content_type: 'video/mp4',
        size_bytes: source.byteLength,
        source_bucket: process.env.S3_SOURCE_BUCKET!,
        source_key: sourceKey,
        status,
        thumbnail_bucket:
          status === VideoStatus.READY
            ? process.env.S3_THUMBNAIL_BUCKET!
            : null,
        thumbnail_key: status === VideoStatus.READY ? thumbnailKey : null,
        duration_seconds: status === VideoStatus.READY ? 2 : null,
        metadata:
          status === VideoStatus.READY
            ? {
                format_name: 'mp4',
                bit_rate: 100,
                video_codec: 'h264',
                audio_codec: null,
                width: 320,
                height: 180,
                frame_rate: '25/1',
              }
            : null,
        uploaded_at: status === VideoStatus.DRAFT ? null : new Date(),
        processed_at: status === VideoStatus.READY ? new Date() : null,
      }),
    );
    return { video, source };
  }

  it('returns redacted owner metadata with conditional READY links', async () => {
    const owner = await createOwner('metadata');
    const { video } = await createVideo(owner.channel, VideoStatus.READY);

    const response = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      id: video.id,
      status: 'READY',
      thumbnail_url: `/videos/${video.id}/thumbnail`,
      stream_url: `/videos/${video.id}/stream`,
      download_url: `/videos/${video.id}/download`,
    });
    expect(response.body).not.toHaveProperty('source_key');
    expect(response.body).not.toHaveProperty('source_bucket');
    expect(response.body).not.toHaveProperty('multipart_upload_id');
  });

  it('masks missing and non-owned UUIDs with the same 404 code', async () => {
    const owner = await createOwner('owner');
    const stranger = await createOwner('stranger');
    const { video } = await createVideo(owner.channel, VideoStatus.DRAFT);

    for (const id of [video.id, randomUUID()]) {
      const response = await request(app.getHttpServer())
        .get(`/videos/${id}`)
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(404);
      expect((response.body as { error: string }).error).toBe(
        'VIDEO_NOT_FOUND',
      );
    }
  });

  it('rejects all binary resources before READY', async () => {
    const owner = await createOwner('not-ready');
    const { video } = await createVideo(owner.channel, VideoStatus.PROCESSING);

    for (const resource of ['thumbnail', 'stream', 'download']) {
      const response = await request(app.getHttpServer())
        .get(`/videos/${video.id}/${resource}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
      expect((response.body as { error: string }).error).toBe(
        'VIDEO_NOT_READY',
      );
    }
  });

  it('redirects thumbnail, range streaming and sanitized download', async () => {
    const owner = await createOwner('redirects');
    const { video, source } = await createVideo(
      owner.channel,
      VideoStatus.READY,
    );
    const authorization = `Bearer ${owner.token}`;

    const thumbnail = await request(app.getHttpServer())
      .get(`/videos/${video.id}/thumbnail`)
      .set('Authorization', authorization)
      .expect(307);
    const thumbnailResponse = await fetch(thumbnail.headers.location);
    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get('content-type')).toBe('image/jpeg');

    const stream = await request(app.getHttpServer())
      .get(`/videos/${video.id}/stream`)
      .set('Authorization', authorization)
      .expect(307);
    const range = await fetch(stream.headers.location, {
      headers: { Range: 'bytes=2-6' },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('accept-ranges')).toBe('bytes');
    expect(range.headers.get('content-range')).toBe(
      `bytes 2-6/${source.length}`,
    );
    expect(Buffer.from(await range.arrayBuffer())).toEqual(
      source.subarray(2, 7),
    );

    const download = await request(app.getHttpServer())
      .get(`/videos/${video.id}/download`)
      .set('Authorization', authorization)
      .expect(307);
    const downloadResponse = await fetch(download.headers.location);
    expect(downloadResponse.headers.get('content-disposition')).toBe(
      'attachment; filename="private_video.mp4"',
    );
    expect(Buffer.from(await downloadResponse.arrayBuffer())).toEqual(source);
  });

  it('requires JWT for metadata and all binary redirects', async () => {
    const id = randomUUID();
    for (const path of [
      `/videos/${id}`,
      `/videos/${id}/thumbnail`,
      `/videos/${id}/stream`,
      `/videos/${id}/download`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
  });
});
