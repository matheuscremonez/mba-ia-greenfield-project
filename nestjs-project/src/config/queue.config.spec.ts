import queueConfig from './queue.config';

describe('queueConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      REDIS_HOST: 'redis',
      REDIS_PORT: '6379',
      REDIS_DB: '2',
      REDIS_CONNECT_TIMEOUT_MS: '2500',
      VIDEO_WORKER_CONCURRENCY: '3',
    };
    delete process.env.REDIS_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should make the HTTP producer fail promptly', () => {
    const config = queueConfig();

    expect(config.producerConnection).toMatchObject({
      host: 'redis',
      port: 6379,
      db: 2,
      connectTimeout: 2500,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  });

  it('should allow the worker connection to retry without request limits', () => {
    const config = queueConfig();

    expect(config.workerConnection.maxRetriesPerRequest).toBeNull();
    expect(config.workerConcurrency).toBe(3);
  });

  it('should omit an empty Redis password', () => {
    expect(queueConfig().producerConnection.password).toBeUndefined();

    process.env.REDIS_PASSWORD = 'queue-secret';

    expect(queueConfig().producerConnection.password).toBe('queue-secret');
  });
});
