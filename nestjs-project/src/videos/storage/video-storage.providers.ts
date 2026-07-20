import { S3Client } from '@aws-sdk/client-s3';
import { Provider } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../../config/storage.config';
import {
  INTERNAL_S3_CLIENT,
  PUBLIC_S3_CLIENT,
  S3_URL_SIGNER,
} from './video-storage.tokens';

function createS3Client(
  config: ConfigType<typeof storageConfig>,
  endpoint: string,
): S3Client {
  return new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export const videoStorageProviders: Provider[] = [
  {
    provide: INTERNAL_S3_CLIENT,
    inject: [storageConfig.KEY],
    useFactory: (config: ConfigType<typeof storageConfig>) =>
      createS3Client(config, config.internalEndpoint),
  },
  {
    provide: PUBLIC_S3_CLIENT,
    inject: [storageConfig.KEY],
    useFactory: (config: ConfigType<typeof storageConfig>) =>
      createS3Client(config, config.publicEndpoint),
  },
  {
    provide: S3_URL_SIGNER,
    useValue: getSignedUrl,
  },
];
