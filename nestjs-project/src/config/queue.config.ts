import { registerAs } from '@nestjs/config';

const optionalPassword = (): string | undefined =>
  process.env.REDIS_PASSWORD || undefined;

export default registerAs('queue', () => {
  const connection = {
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: optionalPassword(),
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    connectTimeout: parseInt(
      process.env.REDIS_CONNECT_TIMEOUT_MS ?? '5000',
      10,
    ),
  };

  return {
    producerConnection: {
      ...connection,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    },
    workerConnection: {
      ...connection,
      maxRetriesPerRequest: null,
    },
    workerConcurrency: parseInt(
      process.env.VIDEO_WORKER_CONCURRENCY ?? '1',
      10,
    ),
  };
});
