import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  S3_INTERNAL_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY_ID: 'streamtube',
  S3_SECRET_ACCESS_KEY: 'streamtube-secret',
  S3_SOURCE_BUCKET: 'streamtube-videos',
  S3_THUMBNAIL_BUCKET: 'streamtube-thumbnails',
  REDIS_HOST: 'redis',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    const value = result.value as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — Phase 03 infrastructure', () => {
  it.each([
    'S3_INTERNAL_ENDPOINT',
    'S3_PUBLIC_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_SOURCE_BUCKET',
    'S3_THUMBNAIL_BUCKET',
    'REDIS_HOST',
  ])('should reject a missing %s', (key) => {
    const env = { ...requiredEnv };
    delete env[key as keyof typeof env];

    const { error } = envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });

    expect(error?.message).toContain(key);
  });

  it('should reject equal source and thumbnail buckets', () => {
    const { error } = validate({
      S3_THUMBNAIL_BUCKET: requiredEnv.S3_SOURCE_BUCKET,
    });

    expect(error?.message).toContain('S3_THUMBNAIL_BUCKET');
  });

  it('should reject invalid Redis settings and worker concurrency', () => {
    const { error } = validate({
      REDIS_PORT: '70000',
      REDIS_CONNECT_TIMEOUT_MS: '50',
      VIDEO_WORKER_CONCURRENCY: '0',
    });

    expect(error?.message).toContain('REDIS_PORT');
    expect(error?.message).toContain('REDIS_CONNECT_TIMEOUT_MS');
    expect(error?.message).toContain('VIDEO_WORKER_CONCURRENCY');
  });
});
