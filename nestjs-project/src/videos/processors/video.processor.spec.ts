import type { ConfigType } from '@nestjs/config';
import { Job } from 'bullmq';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { DataSource, EntityManager, Repository } from 'typeorm';
import storageConfig from '../../config/storage.config';
import { Video } from '../entities/video.entity';
import { VideoMediaService } from '../processing/video-media.service';
import { VideoProcessJobData } from '../queue/video-processing.queue';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoStatus } from '../video-status.enum';
import { VideoProcessor } from './video.processor';

describe('VideoProcessor', () => {
  const settings: ConfigType<typeof storageConfig> = {
    internalEndpoint: 'http://minio:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    sourceBucket: 'streamtube-videos',
    thumbnailBucket: 'streamtube-thumbnails',
    forcePathStyle: true,
    signedUrlExpiresInSeconds: 900,
    partSizeBytes: 67_108_864,
  };
  const video = {
    id: '0e4dc0d0-0925-4cc1-9701-4b29d73255cf',
    status: VideoStatus.PROCESSING,
    source_key: 'videos/id/source',
    thumbnail_bucket: null,
  } as Video;

  let manager: { findOne: jest.Mock; save: jest.Mock };
  let repository: { update: jest.Mock };
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let storage: {
    downloadSource: jest.Mock;
    uploadThumbnail: jest.Mock;
  };
  let media: { probe: jest.Mock; generateThumbnail: jest.Mock };
  let processor: VideoProcessor;

  beforeEach(() => {
    manager = { findOne: jest.fn(), save: jest.fn() };
    repository = { update: jest.fn() };
    dataSource = {
      transaction: jest.fn((callback: (value: EntityManager) => unknown) =>
        Promise.resolve(callback(manager as unknown as EntityManager)),
      ),
      getRepository: jest
        .fn()
        .mockReturnValue(repository as unknown as Repository<Video>),
    };
    storage = {
      downloadSource: jest.fn(),
      uploadThumbnail: jest.fn(),
    };
    media = { probe: jest.fn(), generateThumbnail: jest.fn() };
    processor = new VideoProcessor(
      dataSource as unknown as DataSource,
      storage as unknown as VideoStorageService,
      media as unknown as VideoMediaService,
      settings,
    );
  });

  function job(overrides: Partial<Job<VideoProcessJobData>> = {}) {
    return {
      data: { version: 1, videoId: video.id },
      attemptsMade: 1,
      opts: { attempts: 3 },
      ...overrides,
    } as Job<VideoProcessJobData>;
  }

  it.each([VideoStatus.READY, VideoStatus.DRAFT, VideoStatus.ERROR])(
    'is a no-op for stale state %s',
    async (status) => {
      manager.findOne.mockResolvedValue({ ...video, status });

      await processor.process(job());

      expect(storage.downloadSource).not.toHaveBeenCalled();
    },
  );

  it('processes a source, persists READY and removes its temporary directory', async () => {
    const current = { ...video };
    manager.findOne.mockResolvedValue(current);
    storage.downloadSource.mockResolvedValue(
      Readable.from([Buffer.from('video')]),
    );
    media.probe.mockImplementation((sourcePath: string) => {
      expect(sourcePath).not.toContain(video.source_key);
      return Promise.resolve({
        durationSeconds: 2,
        metadata: {
          format_name: 'mp4',
          bit_rate: 100,
          video_codec: 'h264',
          audio_codec: null,
          width: 320,
          height: 180,
          frame_rate: '25/1',
        },
      });
    });
    let workDirectory = '';
    media.generateThumbnail.mockImplementation(
      async (_sourcePath: string, thumbnailPath: string) => {
        workDirectory = dirname(thumbnailPath);
        await writeFile(thumbnailPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      },
    );

    await processor.process(job());

    expect(storage.uploadThumbnail).toHaveBeenCalledWith(
      `thumbnails/${video.id}/default.jpg`,
      expect.anything(),
      4,
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: VideoStatus.READY,
        duration_seconds: 2,
        thumbnail_bucket: 'streamtube-thumbnails',
        thumbnail_key: `thumbnails/${video.id}/default.jpg`,
      }),
    );
    await expect(
      writeFile(`${workDirectory}/probe`, 'gone'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removes temporary files when media probing fails', async () => {
    manager.findOne.mockResolvedValue({ ...video });
    storage.downloadSource.mockResolvedValue(
      Readable.from([Buffer.from('video')]),
    );
    let sourceDirectory = '';
    media.probe.mockImplementation((sourcePath: string) => {
      sourceDirectory = dirname(sourcePath);
      return Promise.reject(new Error('private ffprobe failure'));
    });

    await expect(processor.process(job())).rejects.toThrow(
      'private ffprobe failure',
    );
    await expect(
      writeFile(`${sourceDirectory}/probe`, 'gone'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks ERROR only after the final attempt with a sanitized diagnostic', async () => {
    await processor.onFailed(
      job({ attemptsMade: 2 }),
      new Error('/tmp/private path'),
    );
    expect(repository.update).not.toHaveBeenCalled();

    await processor.onFailed(
      job({ attemptsMade: 3 }),
      new Error('/tmp/private path'),
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: video.id, status: VideoStatus.PROCESSING },
      expect.objectContaining({
        status: VideoStatus.ERROR,
        processing_error: 'Video processing failed after all retry attempts',
      }),
    );
  });
});
