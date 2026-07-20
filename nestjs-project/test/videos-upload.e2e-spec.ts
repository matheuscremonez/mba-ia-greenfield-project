import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Queue } from 'bullmq';
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
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessJobData,
} from '../src/videos/queue/video-processing.queue';
import { VideoStorageService } from '../src/videos/storage/video-storage.service';

describe('Video uploads (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let jwt: JwtService;
  let storage: VideoStorageService;
  let queue: Queue<VideoProcessJobData>;
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
    queue = fixture.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    throttler = fixture.get(ThrottlerStorage);
  });

  beforeEach(async () => {
    await queue.drain(true);
    await cleanAllTables(dataSource);
    throttler.storage.clear();
  });

  afterEach(async () => {
    for (const video of await videos.find()) {
      await storage.deleteSource(video.source_key);
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

  async function owner(suffix: string): Promise<{ token: string; user: User }> {
    const user = await users.save(
      users.create({ email: `${suffix}@example.com`, password: 'hashed' }),
    );
    await channels.save(
      channels.create({ name: suffix, nickname: suffix, user_id: user.id }),
    );
    return {
      user,
      token: await jwt.signAsync({ sub: user.id, email: user.email }),
    };
  }

  function initiate(token: string, sizeBytes = 12) {
    return request(app.getHttpServer())
      .post('/videos/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Video',
        original_filename: 'video.mp4',
        content_type: 'video/mp4',
        size_bytes: sizeBytes,
      });
  }

  it('initializes a persisted DRAFT with fixed multipart settings', async () => {
    const { token } = await owner('initialize');
    const response = await initiate(token).expect(201);

    expect(response.body).toMatchObject({
      status: 'DRAFT',
      upload: {
        part_size_bytes: 67_108_864,
        part_count: 1,
        expires_in_seconds: 900,
      },
    });
    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.body.upload.upload_id).toBeTruthy();
    await expect(
      videos.findOneBy({ id: response.body.id }),
    ).resolves.toMatchObject({
      status: 'DRAFT',
    });
  });

  it('returns specific validation, size and MIME errors without persistence', async () => {
    const { token } = await owner('invalid');
    const auth = { Authorization: `Bearer ${token}` };

    expect(
      (
        await request(app.getHttpServer())
          .post('/videos/uploads')
          .set(auth)
          .send({})
      ).body.error,
    ).toBe('VALIDATION_ERROR');
    expect((await initiate(token, 10_737_418_241)).body.error).toBe(
      'VIDEO_TOO_LARGE',
    );
    const unsupported = await request(app.getHttpServer())
      .post('/videos/uploads')
      .set(auth)
      .send({
        title: 'Video',
        original_filename: 'video.avi',
        content_type: 'video/x-msvideo',
        size_bytes: 100,
      });
    expect(unsupported.status).toBe(415);
    expect(unsupported.body.error).toBe('VIDEO_TYPE_UNSUPPORTED');
    await expect(videos.count()).resolves.toBe(0);
  });

  it('signs only requested parts and completes into one processing job', async () => {
    const { token } = await owner('complete');
    const payload = Buffer.from('video-source');
    const initialized = await initiate(token, payload.length).expect(201);
    const id = initialized.body.id as string;
    const signed = await request(app.getHttpServer())
      .post(`/videos/${id}/uploads/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1] })
      .expect(200);
    const upload = await fetch(signed.body.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(payload),
    });
    const etag = upload.headers.get('etag');

    await request(app.getHttpServer())
      .post(`/videos/${id}/uploads/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag }] })
      .expect(202)
      .expect({ id, status: 'PROCESSING' });
    expect(await queue.getJob(id)).toMatchObject({
      data: { version: 1, videoId: id },
    });
    const invalid = await request(app.getHttpServer())
      .post(`/videos/${id}/uploads/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [] });
    expect(invalid.body.error).toBe('UPLOAD_PARTS_INVALID');
  });

  it('aborts a draft and removes its row', async () => {
    const { token } = await owner('abort-e2e');
    const initialized = await initiate(token).expect(201);

    await request(app.getHttpServer())
      .delete(`/videos/${initialized.body.id}/uploads`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await expect(
      videos.findOneBy({ id: initialized.body.id }),
    ).resolves.toBeNull();
  });

  it('rejects all upload operations without JWT', async () => {
    const id = '0e4dc0d0-0925-4cc1-9701-4b29d73255cf';
    const calls = [
      () => request(app.getHttpServer()).post('/videos/uploads').send({}),
      () =>
        request(app.getHttpServer())
          .post(`/videos/${id}/uploads/parts`)
          .send({ part_numbers: [1] }),
      () =>
        request(app.getHttpServer())
          .post(`/videos/${id}/uploads/complete`)
          .send({ parts: [] }),
      () => request(app.getHttpServer()).delete(`/videos/${id}/uploads`),
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(401);
    }
    await expect(videos.count()).resolves.toBe(0);
  });
});
