import { registerAs } from '@nestjs/config';

export const VIDEO_PART_SIZE_BYTES = 64 * 1024 * 1024;
export const SIGNED_URL_EXPIRES_IN_SECONDS = 15 * 60;

export default registerAs('storage', () => ({
  internalEndpoint: process.env.S3_INTERNAL_ENDPOINT!,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT!,
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  sourceBucket: process.env.S3_SOURCE_BUCKET!,
  thumbnailBucket: process.env.S3_THUMBNAIL_BUCKET!,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  signedUrlExpiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS,
  partSizeBytes: VIDEO_PART_SIZE_BYTES,
}));
