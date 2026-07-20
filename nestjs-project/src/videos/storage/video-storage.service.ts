import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'node:stream';
import storageConfig from '../../config/storage.config';
import { StorageUnavailableException } from '../exceptions/video.exceptions';
import {
  CompletedUploadPart,
  MultipartUploadDescriptor,
  SignedObjectUrl,
  SignedUploadPart,
  StoredSourceObject,
  ThumbnailBody,
} from './video-storage.types';
import {
  INTERNAL_S3_CLIENT,
  PUBLIC_S3_CLIENT,
  S3_URL_SIGNER,
} from './video-storage.tokens';

const MAX_SIGNED_PARTS_PER_REQUEST = 20;

@Injectable()
export class VideoStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(VideoStorageService.name);

  constructor(
    @Inject(INTERNAL_S3_CLIENT)
    private readonly internalClient: S3Client,
    @Inject(PUBLIC_S3_CLIENT)
    private readonly publicClient: S3Client,
    @Inject(S3_URL_SIGNER)
    private readonly signUrl: typeof getSignedUrl,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  onModuleDestroy(): void {
    this.internalClient.destroy();
    this.publicClient.destroy();
  }

  async createMultipartUpload(
    sourceKey: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<MultipartUploadDescriptor> {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new RangeError('sizeBytes must be a positive safe integer');
    }

    const response = await this.runStorageOperation(
      'create multipart upload',
      () =>
        this.internalClient.send(
          new CreateMultipartUploadCommand({
            Bucket: this.config.sourceBucket,
            Key: sourceKey,
            ContentType: contentType,
          }),
        ),
    );

    if (!response.UploadId) {
      throw this.storageUnavailable('create multipart upload');
    }

    return {
      uploadId: response.UploadId,
      partSizeBytes: this.config.partSizeBytes,
      partCount: Math.ceil(sizeBytes / this.config.partSizeBytes),
      expiresAt: this.expiresAt(),
    };
  }

  async signUploadParts(
    sourceKey: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<SignedUploadPart[]> {
    if (
      partNumbers.length < 1 ||
      partNumbers.length > MAX_SIGNED_PARTS_PER_REQUEST ||
      new Set(partNumbers).size !== partNumbers.length ||
      partNumbers.some(
        (partNumber) => !Number.isInteger(partNumber) || partNumber < 1,
      )
    ) {
      throw new RangeError(
        'partNumbers must contain between 1 and 20 distinct positive integers',
      );
    }

    const expiresAt = this.expiresAt();

    return this.runStorageOperation('sign upload parts', async () =>
      Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await this.signUrl(
            this.publicClient,
            new UploadPartCommand({
              Bucket: this.config.sourceBucket,
              Key: sourceKey,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: this.config.signedUrlExpiresInSeconds },
          ),
          expiresAt,
        })),
      ),
    );
  }

  async completeMultipartUpload(
    sourceKey: string,
    uploadId: string,
    parts: CompletedUploadPart[],
  ): Promise<void> {
    await this.runStorageOperation('complete multipart upload', () =>
      this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.sourceBucket,
          Key: sourceKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((left, right) => left.partNumber - right.partNumber)
              .map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
              })),
          },
        }),
      ),
    );
  }

  async headSource(sourceKey: string): Promise<StoredSourceObject> {
    const response = await this.runStorageOperation(
      'inspect source object',
      () =>
        this.internalClient.send(
          new HeadObjectCommand({
            Bucket: this.config.sourceBucket,
            Key: sourceKey,
          }),
        ),
    );

    if (response.ContentLength === undefined) {
      throw this.storageUnavailable('inspect source object');
    }

    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      etag: response.ETag,
    };
  }

  async headSourceIfExists(
    sourceKey: string,
  ): Promise<StoredSourceObject | null> {
    try {
      const response = await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: this.config.sourceBucket,
          Key: sourceKey,
        }),
      );
      if (response.ContentLength === undefined) {
        throw this.storageUnavailable('inspect source object');
      }
      return {
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch (error) {
      if (this.isMissingStorageResource(error)) {
        return null;
      }
      if (error instanceof StorageUnavailableException) {
        throw error;
      }
      throw this.storageUnavailable('inspect source object', error);
    }
  }

  async abortMultipartUpload(
    sourceKey: string,
    uploadId: string,
  ): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.sourceBucket,
          Key: sourceKey,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (!this.isMissingStorageResource(error)) {
        throw this.storageUnavailable('abort multipart upload', error);
      }
    }
  }

  async downloadSource(sourceKey: string): Promise<Readable> {
    const response = await this.runStorageOperation(
      'download source object',
      () =>
        this.internalClient.send(
          new GetObjectCommand({
            Bucket: this.config.sourceBucket,
            Key: sourceKey,
          }),
        ),
    );

    if (!response.Body) {
      throw this.storageUnavailable('download source object');
    }

    if (response.Body instanceof Readable) {
      return response.Body;
    }

    return Readable.from(response.Body as AsyncIterable<Uint8Array>);
  }

  async uploadThumbnail(
    thumbnailKey: string,
    body: ThumbnailBody,
    contentLength?: number,
  ): Promise<void> {
    await this.runStorageOperation('upload thumbnail', () =>
      this.internalClient.send(
        new PutObjectCommand({
          Bucket: this.config.thumbnailBucket,
          Key: thumbnailKey,
          Body: body,
          ContentLength: contentLength,
          ContentType: 'image/jpeg',
        }),
      ),
    );
  }

  async deleteSource(sourceKey: string): Promise<void> {
    await this.deleteObject(this.config.sourceBucket, sourceKey);
  }

  async deleteThumbnail(thumbnailKey: string): Promise<void> {
    await this.deleteObject(this.config.thumbnailBucket, thumbnailKey);
  }

  async signThumbnail(thumbnailKey: string): Promise<SignedObjectUrl> {
    return this.signGetObject(
      new GetObjectCommand({
        Bucket: this.config.thumbnailBucket,
        Key: thumbnailKey,
        ResponseContentType: 'image/jpeg',
      }),
    );
  }

  async signStream(sourceKey: string): Promise<SignedObjectUrl> {
    return this.signGetObject(
      new GetObjectCommand({
        Bucket: this.config.sourceBucket,
        Key: sourceKey,
      }),
    );
  }

  async signDownload(
    sourceKey: string,
    filename: string,
  ): Promise<SignedObjectUrl> {
    const safeFilename = this.sanitizeFilename(filename);

    return this.signGetObject(
      new GetObjectCommand({
        Bucket: this.config.sourceBucket,
        Key: sourceKey,
        ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      }),
    );
  }

  private async signGetObject(
    command: GetObjectCommand,
  ): Promise<SignedObjectUrl> {
    const url = await this.runStorageOperation('sign object download', () =>
      this.signUrl(this.publicClient, command, {
        expiresIn: this.config.signedUrlExpiresInSeconds,
      }),
    );

    return { url, expiresAt: this.expiresAt() };
  }

  private async deleteObject(bucket: string, key: string): Promise<void> {
    await this.runStorageOperation('delete object', () =>
      this.internalClient.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      ),
    );
  }

  private sanitizeFilename(filename: string): string {
    const sanitized = filename
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^[._-]+/, '')
      .slice(0, 120);

    return sanitized || 'video';
  }

  private expiresAt(): Date {
    return new Date(Date.now() + this.config.signedUrlExpiresInSeconds * 1_000);
  }

  private async runStorageOperation<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof StorageUnavailableException) {
        throw error;
      }

      throw this.storageUnavailable(operation, error);
    }
  }

  private storageUnavailable(
    operation: string,
    cause?: unknown,
  ): StorageUnavailableException {
    const stack = cause instanceof Error ? cause.stack : undefined;
    this.logger.error(`S3 operation failed: ${operation}`, stack);
    return new StorageUnavailableException();
  }

  private isMissingStorageResource(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const providerError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      providerError.$metadata?.httpStatusCode === 404 ||
      providerError.name === 'NotFound' ||
      providerError.name === 'NoSuchKey' ||
      providerError.name === 'NoSuchUpload'
    );
  }
}
