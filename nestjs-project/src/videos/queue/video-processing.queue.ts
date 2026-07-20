import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueUnavailableException } from '../exceptions/video.exceptions';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const VIDEO_PROCESS_JOB = 'video.process';

export interface VideoProcessJobData {
  version: 1;
  videoId: string;
}

@Injectable()
export class VideoProcessingQueue {
  private readonly logger = new Logger(VideoProcessingQueue.name);

  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessJobData>,
  ) {}

  async publish(videoId: string): Promise<void> {
    try {
      await this.queue.add(
        VIDEO_PROCESS_JOB,
        { version: 1, videoId },
        {
          jobId: videoId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to publish video processing job',
        error instanceof Error ? error.stack : undefined,
      );
      throw new QueueUnavailableException();
    }
  }
}
