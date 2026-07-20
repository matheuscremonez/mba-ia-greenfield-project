import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { UploadSizeMismatchException } from './exceptions/video.exceptions';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessJobData,
} from './queue/video-processing.queue';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoStatus } from './video-status.enum';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (PostgreSQL + MinIO + Redis integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let service: VideosService;
  let storage: VideoStorageService;
  let queue: Queue<VideoProcessJobData>;
  let originalPublicEndpoint: string | undefined;

  beforeAll(async () => {
    originalPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
    process.env.S3_PUBLIC_ENDPOINT = process.env.S3_INTERNAL_ENDPOINT;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ load: [storageConfig] }),
        BullModule.forRoot({
          connection: {
            host: process.env.REDIS_HOST!,
            port: Number(process.env.REDIS_PORT ?? 6379),
            db: Number(process.env.REDIS_DB ?? 0),
          },
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();
    dataSource = module.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    service = module.get(VideosService);
    storage = module.get(VideoStorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  beforeEach(async () => {
    await cleanState();
  });

  afterEach(async () => {
    for (const item of await videos.find()) {
      await storage.deleteSource(item.source_key);
    }
    await cleanState();
  });

  afterAll(async () => {
    await module.close();
    if (originalPublicEndpoint === undefined) {
      delete process.env.S3_PUBLIC_ENDPOINT;
    } else {
      process.env.S3_PUBLIC_ENDPOINT = originalPublicEndpoint;
    }
  });

  async function cleanState(): Promise<void> {
    await queue.drain(true);
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
  }

  async function createOwner(suffix: string): Promise<User> {
    const user = await users.save(
      users.create({ email: `${suffix}@example.com`, password: 'hashed' }),
    );
    await channels.save(
      channels.create({
        name: `Channel ${suffix}`,
        nickname: suffix,
        user_id: user.id,
      }),
    );
    return user;
  }

  async function uploadPart(
    userId: string,
    videoId: string,
    uploadId: string,
    payload: Uint8Array,
  ): Promise<string> {
    const [part] = await service.signUploadParts(userId, videoId, [1]);
    const body = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer;
    const response = await fetch(part.url, { method: 'PUT', body });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    expect(uploadId).toBeTruthy();
    return etag!;
  }

  it('initiates, completes, verifies and idempotently schedules one job', async () => {
    const owner = await createOwner('lifecycle');
    const payload = new TextEncoder().encode('video-source');
    const initiated = await service.initiateUpload(owner.id, {
      title: ' Lifecycle ',
      originalFilename: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: payload.byteLength,
    });
    const etag = await uploadPart(
      owner.id,
      initiated.video.id,
      initiated.upload.uploadId,
      payload,
    );

    const completed = await service.completeUpload(
      owner.id,
      initiated.video.id,
      [{ partNumber: 1, etag }],
    );
    const repeated = await service.completeUpload(
      owner.id,
      initiated.video.id,
      [{ partNumber: 1, etag }],
    );

    expect(completed.status).toBe(VideoStatus.PROCESSING);
    expect(repeated.status).toBe(VideoStatus.PROCESSING);
    const persisted = await videos.findOneByOrFail({ id: initiated.video.id });
    expect(persisted.multipart_upload_id).toBeNull();
    expect(persisted.uploaded_at).toBeInstanceOf(Date);
    expect(await queue.getJob(initiated.video.id)).toMatchObject({
      data: { version: 1, videoId: initiated.video.id },
    });
  });

  it('deletes an invalid-size object while preserving the draft', async () => {
    const owner = await createOwner('mismatch');
    const initiated = await service.initiateUpload(owner.id, {
      title: 'Mismatch',
      originalFilename: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 10,
    });
    const payload = new Uint8Array([1, 2, 3]);
    const etag = await uploadPart(
      owner.id,
      initiated.video.id,
      initiated.upload.uploadId,
      payload,
    );

    await expect(
      service.completeUpload(owner.id, initiated.video.id, [
        { partNumber: 1, etag },
      ]),
    ).rejects.toBeInstanceOf(UploadSizeMismatchException);
    expect(
      (await videos.findOneByOrFail({ id: initiated.video.id })).status,
    ).toBe(VideoStatus.DRAFT);
    await expect(
      storage.headSourceIfExists(initiated.video.source_key),
    ).resolves.toBeNull();
  });

  it('aborts storage and removes only the owned draft row', async () => {
    const owner = await createOwner('abort');
    const initiated = await service.initiateUpload(owner.id, {
      title: 'Abort',
      originalFilename: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: 100,
    });

    await service.abortUpload(owner.id, initiated.video.id);

    await expect(
      videos.findOneBy({ id: initiated.video.id }),
    ).resolves.toBeNull();
  });
});
