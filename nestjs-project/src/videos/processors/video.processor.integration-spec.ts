import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import {
  runProcessCommand,
  videoMediaProviders,
} from '../processing/video-media.providers';
import { VideoMediaService } from '../processing/video-media.service';
import { VideoProcessJobData } from '../queue/video-processing.queue';
import { videoStorageProviders } from '../storage/video-storage.providers';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoStatus } from '../video-status.enum';
import { VideoProcessor } from './video.processor';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessor (real media integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let channels: Repository<Channel>;
  let videos: Repository<Video>;
  let storage: VideoStorageService;
  let processor: VideoProcessor;
  let originalPublicEndpoint: string | undefined;
  let fixtureDirectory: string;
  let fixture: Buffer;

  beforeAll(async () => {
    originalPublicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
    process.env.S3_PUBLIC_ENDPOINT = process.env.S3_INTERNAL_ENDPOINT;
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
      ],
      providers: [
        ...videoStorageProviders,
        ...videoMediaProviders,
        VideoStorageService,
        VideoMediaService,
        VideoProcessor,
      ],
    }).compile();
    dataSource = module.get(DataSource);
    users = dataSource.getRepository(User);
    channels = dataSource.getRepository(Channel);
    videos = dataSource.getRepository(Video);
    storage = module.get(VideoStorageService);
    processor = module.get(VideoProcessor);

    fixtureDirectory = await mkdtemp(join(tmpdir(), 'streamtube-fixture-'));
    const fixturePath = join(fixtureDirectory, 'source.mp4');
    await runProcessCommand('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x240:d=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=2',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-shortest',
      fixturePath,
    ]);
    fixture = await readFile(fixturePath);
  }, 30_000);

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
  });

  afterAll(async () => {
    for (const video of await videos.find()) {
      await storage.deleteSource(video.source_key);
      if (video.thumbnail_key) {
        await storage.deleteThumbnail(video.thumbnail_key);
      }
    }
    await module.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    if (originalPublicEndpoint === undefined) {
      delete process.env.S3_PUBLIC_ENDPOINT;
    } else {
      process.env.S3_PUBLIC_ENDPOINT = originalPublicEndpoint;
    }
  });

  it('extracts metadata, uploads a JPEG and idempotently persists READY', async () => {
    const user = await users.save(
      users.create({ email: 'processor@example.com', password: 'hashed' }),
    );
    const channel = await channels.save(
      channels.create({
        name: 'Processor',
        nickname: 'processor',
        user_id: user.id,
      }),
    );
    const sourceKey = `videos/${user.id}/source`;
    const multipart = await storage.createMultipartUpload(
      sourceKey,
      'video/mp4',
      fixture.byteLength,
    );
    const [signedPart] = await storage.signUploadParts(
      sourceKey,
      multipart.uploadId,
      [1],
    );
    const body = fixture.buffer.slice(
      fixture.byteOffset,
      fixture.byteOffset + fixture.byteLength,
    ) as ArrayBuffer;
    const upload = await fetch(signedPart.url, { method: 'PUT', body });
    const etag = upload.headers.get('etag');
    expect(upload.status).toBe(200);
    expect(etag).toBeTruthy();
    await storage.completeMultipartUpload(sourceKey, multipart.uploadId, [
      { partNumber: 1, etag: etag! },
    ]);

    const video = await videos.save(
      videos.create({
        channel_id: channel.id,
        title: 'Fixture',
        original_filename: 'fixture.mp4',
        content_type: 'video/mp4',
        size_bytes: fixture.byteLength,
        source_bucket: process.env.S3_SOURCE_BUCKET!,
        source_key: sourceKey,
        status: VideoStatus.PROCESSING,
        uploaded_at: new Date(),
      }),
    );
    const job = {
      data: { version: 1, videoId: video.id },
      attemptsMade: 0,
      opts: { attempts: 3 },
    } as Job<VideoProcessJobData>;

    await processor.process(job);
    const ready = await videos.findOneByOrFail({ id: video.id });
    expect(ready.status).toBe(VideoStatus.READY);
    expect(ready.duration_seconds).toBeGreaterThan(1.9);
    expect(ready.metadata).toMatchObject({
      video_codec: 'mpeg4',
      audio_codec: 'aac',
      width: 320,
      height: 240,
    });
    expect(ready.thumbnail_key).toBe(`thumbnails/${video.id}/default.jpg`);
    expect(ready.processing_error).toBeNull();
    expect(ready.processed_at).toBeInstanceOf(Date);

    const thumbnail = await storage.signThumbnail(ready.thumbnail_key!);
    const thumbnailResponse = await fetch(thumbnail.url);
    const jpeg = new Uint8Array(await thumbnailResponse.arrayBuffer());
    expect(thumbnailResponse.status).toBe(200);
    expect([...jpeg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    const processedAt = ready.processed_at;
    await processor.process(job);
    const repeated = await videos.findOneByOrFail({ id: video.id });
    expect(repeated.processed_at).toEqual(processedAt);
    expect(repeated.thumbnail_key).toBe(ready.thumbnail_key);

    await storage.deleteSource(sourceKey);
    await storage.deleteThumbnail(ready.thumbnail_key!);
    expect((await stat(fixtureDirectory)).isDirectory()).toBe(true);
  }, 30_000);
});
