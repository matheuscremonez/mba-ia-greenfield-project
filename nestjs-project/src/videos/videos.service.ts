import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import {
  CompletedUploadPart,
  MultipartUploadDescriptor,
  SignedUploadPart,
} from './storage/video-storage.types';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoStatus } from './video-status.enum';
import {
  UploadPartsInvalidException,
  UploadSizeMismatchException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoTooLargeException,
  VideoTypeUnsupportedException,
} from './exceptions/video.exceptions';
import { VideoProcessingQueue } from './queue/video-processing.queue';

export interface InitiateVideoUploadInput {
  title: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

export interface InitiatedVideoUpload {
  video: Video;
  upload: MultipartUploadDescriptor;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storage: VideoStorageService,
    private readonly processingQueue: VideoProcessingQueue,
    @Inject(storageConfig.KEY)
    private readonly storageSettings: ConfigType<typeof storageConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    input: InitiateVideoUploadInput,
  ): Promise<InitiatedVideoUpload> {
    if (input.sizeBytes > 10_737_418_240) {
      throw new VideoTooLargeException();
    }
    if (
      !['video/mp4', 'video/webm', 'video/quicktime'].includes(
        input.contentType,
      )
    ) {
      throw new VideoTypeUnsupportedException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const id = randomUUID();
    const sourceKey = `videos/${id}/source`;
    const video = await this.videos.save(
      this.videos.create({
        id,
        channel_id: channel.id,
        title: input.title.trim(),
        status: VideoStatus.DRAFT,
        original_filename: input.originalFilename,
        content_type: input.contentType,
        size_bytes: input.sizeBytes,
        source_bucket: this.storageSettings.sourceBucket,
        source_key: sourceKey,
        thumbnail_bucket: null,
        thumbnail_key: null,
        multipart_upload_id: null,
        duration_seconds: null,
        metadata: null,
        processing_error: null,
        uploaded_at: null,
        processed_at: null,
      }),
    );

    let upload: MultipartUploadDescriptor;
    try {
      upload = await this.storage.createMultipartUpload(
        sourceKey,
        input.contentType,
        input.sizeBytes,
      );
    } catch (error) {
      await this.videos.delete(video.id);
      throw error;
    }

    video.multipart_upload_id = upload.uploadId;
    try {
      await this.videos.save(video);
    } catch (error) {
      await this.storage.abortMultipartUpload(sourceKey, upload.uploadId);
      await this.videos.delete(video.id);
      throw error;
    }

    return { video, upload };
  }

  async signUploadParts(
    userId: string,
    videoId: string,
    partNumbers: number[],
  ): Promise<SignedUploadPart[]> {
    const video = await this.findOwnedVideo(userId, videoId);
    this.assertActiveDraft(video);

    const partCount = this.partCount(video.size_bytes);
    if (
      !Array.isArray(partNumbers) ||
      partNumbers.length < 1 ||
      partNumbers.length > 20 ||
      new Set(partNumbers).size !== partNumbers.length ||
      partNumbers.some(
        (partNumber) =>
          !Number.isInteger(partNumber) ||
          partNumber < 1 ||
          partNumber > partCount,
      )
    ) {
      throw new UploadPartsInvalidException();
    }

    return this.storage.signUploadParts(
      video.source_key,
      video.multipart_upload_id!,
      partNumbers,
    );
  }

  async completeUpload(
    userId: string,
    videoId: string,
    parts: CompletedUploadPart[],
  ): Promise<Video> {
    const video = await this.findOwnedVideo(userId, videoId);
    if (video.status === VideoStatus.PROCESSING) {
      return video;
    }
    this.assertActiveDraft(video);
    this.assertCompletePartList(parts, this.partCount(video.size_bytes));

    const uploadId = video.multipart_upload_id!;
    let storedObject = await this.storage.headSourceIfExists(video.source_key);
    if (!storedObject) {
      await this.storage.completeMultipartUpload(
        video.source_key,
        uploadId,
        parts,
      );
      storedObject = await this.storage.headSource(video.source_key);
    }

    if (storedObject.contentLength !== video.size_bytes) {
      await this.storage.deleteSource(video.source_key);
      throw new UploadSizeMismatchException();
    }

    const uploadedAt = new Date();
    const transition = await this.videos.update(
      {
        id: video.id,
        status: VideoStatus.DRAFT,
        multipart_upload_id: uploadId,
      },
      {
        status: VideoStatus.PROCESSING,
        multipart_upload_id: null,
        uploaded_at: uploadedAt,
      },
    );

    if (transition.affected !== 1) {
      const current = await this.findOwnedVideo(userId, videoId);
      if (current.status === VideoStatus.PROCESSING) {
        return current;
      }
      throw new VideoInvalidStateException();
    }

    try {
      await this.processingQueue.publish(video.id);
    } catch (error) {
      await this.videos.update(
        { id: video.id, status: VideoStatus.PROCESSING },
        {
          status: VideoStatus.DRAFT,
          multipart_upload_id: uploadId,
          uploaded_at: null,
        },
      );
      throw error;
    }

    video.status = VideoStatus.PROCESSING;
    video.multipart_upload_id = null;
    video.uploaded_at = uploadedAt;
    return video;
  }

  async abortUpload(userId: string, videoId: string): Promise<void> {
    const video = await this.findOwnedVideo(userId, videoId);
    if (video.status !== VideoStatus.DRAFT) {
      throw new VideoInvalidStateException();
    }

    if (video.multipart_upload_id) {
      await this.storage.abortMultipartUpload(
        video.source_key,
        video.multipart_upload_id,
      );
    }
    await this.storage.deleteSource(video.source_key);

    const deletion = await this.videos.delete({
      id: video.id,
      status: VideoStatus.DRAFT,
    });
    if (deletion.affected !== 1) {
      throw new VideoInvalidStateException();
    }
  }

  private async findOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const video = await this.videos.findOne({
      where: { id: videoId, channel: { user_id: userId } },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private assertActiveDraft(video: Video): void {
    if (
      video.status !== VideoStatus.DRAFT ||
      video.multipart_upload_id === null
    ) {
      throw new VideoInvalidStateException();
    }
  }

  private assertCompletePartList(
    parts: CompletedUploadPart[],
    expectedCount: number,
  ): void {
    if (
      !Array.isArray(parts) ||
      parts.length !== expectedCount ||
      parts.some(
        (part, index) =>
          typeof part !== 'object' ||
          part === null ||
          part.partNumber !== index + 1 ||
          typeof part.etag !== 'string' ||
          part.etag.trim().length === 0,
      )
    ) {
      throw new UploadPartsInvalidException();
    }
  }

  private partCount(sizeBytes: number): number {
    return Math.ceil(sizeBytes / this.storageSettings.partSizeBytes);
  }
}
