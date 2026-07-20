import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  VIDEO_PROCESSING_QUEUE,
  VIDEO_PROCESS_JOB,
  VideoProcessJobData,
  VideoProcessingQueue,
} from './video-processing.queue';

describe('VideoProcessingQueue (Redis integration)', () => {
  let module: TestingModule;
  let queue: Queue<VideoProcessJobData>;
  let producer: VideoProcessingQueue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: {
            host: process.env.REDIS_HOST!,
            port: Number(process.env.REDIS_PORT ?? 6379),
            db: Number(process.env.REDIS_DB ?? 0),
          },
          prefix: `streamtube-test-${randomUUID()}`,
        }),
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
      providers: [VideoProcessingQueue],
    }).compile();
    producer = module.get(VideoProcessingQueue);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  it('publishes a versioned, deduplicated job with bounded retry and retention', async () => {
    const videoId = randomUUID();

    await producer.publish(videoId);
    await producer.publish(videoId);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const matchingJobs = jobs.filter((job) => job.id === videoId);
    expect(matchingJobs).toHaveLength(1);
    expect(matchingJobs[0]).toMatchObject({
      id: videoId,
      name: VIDEO_PROCESS_JOB,
      data: { version: 1, videoId },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  });
});
