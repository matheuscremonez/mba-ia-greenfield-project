import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job } from 'bullmq';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { DataSource, EntityManager } from 'typeorm';
import { Video } from '../entities/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessJobData,
} from '../queue/video-processing.queue';
import { VideoMediaService } from '../processing/video-media.service';
import { VideoStorageService } from '../storage/video-storage.service';
import { VideoStatus } from '../video-status.enum';
import storageConfig from '../../config/storage.config';

const workerConcurrency = Number(process.env.VIDEO_WORKER_CONCURRENCY ?? 1);

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: workerConcurrency })
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: VideoStorageService,
    private readonly media: VideoMediaService,
    @Inject(storageConfig.KEY)
    private readonly storageSettings: ConfigType<typeof storageConfig>,
  ) {
    super();
  }

  async process(job: Job<VideoProcessJobData>): Promise<void> {
    if (job.data.version !== 1 || typeof job.data.videoId !== 'string') {
      throw new Error('Unsupported video processing job payload');
    }

    const video = await this.lockVideo(job.data.videoId);
    if (!video || video.status !== VideoStatus.PROCESSING) {
      return;
    }

    const workDirectory = await mkdtemp(
      join(tmpdir(), `streamtube-video-${video.id}-`),
    );
    const sourcePath = join(workDirectory, 'source');
    const thumbnailPath = join(workDirectory, 'thumbnail.jpg');
    const thumbnailKey = `thumbnails/${video.id}/default.jpg`;

    try {
      const source = await this.storage.downloadSource(video.source_key);
      await pipeline(source, createWriteStream(sourcePath, { mode: 0o600 }));
      const probed = await this.media.probe(sourcePath);
      await this.media.generateThumbnail(sourcePath, thumbnailPath);
      const thumbnailStat = await stat(thumbnailPath);
      await this.storage.uploadThumbnail(
        thumbnailKey,
        createReadStream(thumbnailPath),
        thumbnailStat.size,
      );

      await this.dataSource.transaction(async (manager) => {
        const current = await this.findLocked(manager, video.id);
        if (!current || current.status !== VideoStatus.PROCESSING) {
          return;
        }
        current.duration_seconds = probed.durationSeconds;
        current.metadata = probed.metadata;
        current.thumbnail_bucket = this.storageSettings.thumbnailBucket;
        current.thumbnail_key = thumbnailKey;
        current.processing_error = null;
        current.processed_at = new Date();
        current.status = VideoStatus.READY;
        await manager.save(current);
      });
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
      return;
    }

    this.logger.error(
      `Video processing exhausted retries for ${job.data.videoId}`,
      error.stack,
    );
    await this.dataSource.getRepository(Video).update(
      { id: job.data.videoId, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.ERROR,
        processing_error: 'Video processing failed after all retry attempts',
        processed_at: new Date(),
      },
    );
  }

  private lockVideo(videoId: string): Promise<Video | null> {
    return this.dataSource.transaction((manager) =>
      this.findLocked(manager, videoId),
    );
  }

  private findLocked(
    manager: EntityManager,
    videoId: string,
  ): Promise<Video | null> {
    return manager.findOne(Video, {
      where: { id: videoId },
      lock: { mode: 'pessimistic_write' },
    });
  }
}
