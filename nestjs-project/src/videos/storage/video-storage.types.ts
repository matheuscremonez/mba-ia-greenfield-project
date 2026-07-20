import { Readable } from 'node:stream';

export interface MultipartUploadDescriptor {
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
  expiresAt: Date;
}

export interface SignedUploadPart {
  partNumber: number;
  url: string;
  expiresAt: Date;
}

export interface CompletedUploadPart {
  partNumber: number;
  etag: string;
}

export interface StoredSourceObject {
  contentLength: number;
  contentType?: string;
  etag?: string;
}

export interface SignedObjectUrl {
  url: string;
  expiresAt: Date;
}

export type ThumbnailBody = Readable | Uint8Array;
