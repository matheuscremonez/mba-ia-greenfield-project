import storageConfig, {
  SIGNED_URL_EXPIRES_IN_SECONDS,
  VIDEO_PART_SIZE_BYTES,
} from './storage.config';

describe('storageConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      S3_INTERNAL_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'streamtube',
      S3_SECRET_ACCESS_KEY: 'streamtube-secret',
      S3_SOURCE_BUCKET: 'streamtube-videos',
      S3_THUMBNAIL_BUCKET: 'streamtube-thumbnails',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should keep internal and browser-reachable endpoints separate', () => {
    const config = storageConfig();

    expect(config.internalEndpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('http://localhost:9000');
    expect(config.sourceBucket).toBe('streamtube-videos');
    expect(config.thumbnailBucket).toBe('streamtube-thumbnails');
  });

  it('should expose fixed multipart and signing constants', () => {
    const config = storageConfig();

    expect(config.partSizeBytes).toBe(VIDEO_PART_SIZE_BYTES);
    expect(VIDEO_PART_SIZE_BYTES).toBe(67_108_864);
    expect(config.signedUrlExpiresInSeconds).toBe(
      SIGNED_URL_EXPIRES_IN_SECONDS,
    );
    expect(SIGNED_URL_EXPIRES_IN_SECONDS).toBe(900);
  });

  it('should enable path style by default and allow disabling it', () => {
    expect(storageConfig().forcePathStyle).toBe(true);

    process.env.S3_FORCE_PATH_STYLE = 'false';

    expect(storageConfig().forcePathStyle).toBe(false);
  });
});
