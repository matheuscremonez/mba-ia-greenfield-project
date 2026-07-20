import type { ConfigType } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import {
  QueueUnavailableException,
  UploadPartsInvalidException,
  UploadSizeMismatchException,
  VideoInvalidStateException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoTooLargeException,
  VideoTypeUnsupportedException,
} from './exceptions/video.exceptions';
import { VideoProcessingQueue } from './queue/video-processing.queue';
import { VideoStorageService } from './storage/video-storage.service';
import { VideoStatus } from './video-status.enum';
import { VideosService } from './videos.service';

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: '0e4dc0d0-0925-4cc1-9701-4b29d73255cf',
    channel_id: '4e16ddca-b47c-4fd1-93fc-0fb3a23f3890',
    title: 'Video',
    status: VideoStatus.DRAFT,
    original_filename: 'video.mp4',
    content_type: 'video/mp4',
    size_bytes: 100,
    source_bucket: 'streamtube-videos',
    source_key: 'videos/id/source',
    thumbnail_bucket: null,
    thumbnail_key: null,
    multipart_upload_id: 'upload-1',
    duration_seconds: null,
    metadata: null,
    processing_error: null,
    uploaded_at: null,
    processed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: {} as Channel,
    ...overrides,
  };
}

describe('VideosService', () => {
  const config: ConfigType<typeof storageConfig> = {
    internalEndpoint: 'http://minio:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    sourceBucket: 'streamtube-videos',
    thumbnailBucket: 'streamtube-thumbnails',
    forcePathStyle: true,
    signedUrlExpiresInSeconds: 900,
    partSizeBytes: 64,
  };
  const userId = '41e93a50-5ff6-4f2e-8e10-d6fb38b73bc7';

  let repository: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let channels: { findByUserId: jest.Mock };
  let storage: {
    createMultipartUpload: jest.Mock;
    signUploadParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    headSourceIfExists: jest.Mock;
    headSource: jest.Mock;
    abortMultipartUpload: jest.Mock;
    deleteSource: jest.Mock;
    signThumbnail: jest.Mock;
    signStream: jest.Mock;
    signDownload: jest.Mock;
  };
  let queue: { publish: jest.Mock };
  let service: VideosService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    channels = { findByUserId: jest.fn() };
    storage = {
      createMultipartUpload: jest.fn(),
      signUploadParts: jest.fn(),
      completeMultipartUpload: jest.fn(),
      headSourceIfExists: jest.fn(),
      headSource: jest.fn(),
      abortMultipartUpload: jest.fn(),
      deleteSource: jest.fn(),
      signThumbnail: jest.fn(),
      signStream: jest.fn(),
      signDownload: jest.fn(),
    };
    queue = { publish: jest.fn() };
    service = new VideosService(
      repository as unknown as Repository<Video>,
      channels as unknown as ChannelsService,
      storage as unknown as VideoStorageService,
      queue as unknown as VideoProcessingQueue,
      config,
    );
  });

  it('removes the draft when multipart initialization fails', async () => {
    const draft = video({ multipart_upload_id: null });
    channels.findByUserId.mockResolvedValue({ id: draft.channel_id });
    repository.create.mockReturnValue(draft);
    repository.save.mockResolvedValue(draft);
    storage.createMultipartUpload.mockRejectedValue(new Error('storage down'));
    repository.delete.mockResolvedValue({ affected: 1 });

    await expect(
      service.initiateUpload(userId, {
        title: ' Video ',
        originalFilename: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 100,
      }),
    ).rejects.toThrow('storage down');
    expect(repository.delete).toHaveBeenCalledWith(draft.id);
  });

  it('rejects oversized and unsupported sources before persistence', async () => {
    await expect(
      service.initiateUpload(userId, {
        title: 'Video',
        originalFilename: 'video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 10_737_418_241,
      }),
    ).rejects.toBeInstanceOf(VideoTooLargeException);
    await expect(
      service.initiateUpload(userId, {
        title: 'Video',
        originalFilename: 'video.avi',
        contentType: 'video/x-msvideo',
        sizeBytes: 100,
      }),
    ).rejects.toBeInstanceOf(VideoTypeUnsupportedException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('masks absent and non-owned videos with the same not-found error', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.signUploadParts(userId, video().id, [1]),
    ).rejects.toBeInstanceOf(VideoNotFoundException);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: video().id, channel: { user_id: userId } },
    });
  });

  it('validates requested part numbers against the persisted size', async () => {
    repository.findOne.mockResolvedValue(video({ size_bytes: 128 }));

    await expect(
      service.signUploadParts(userId, video().id, [1, 3]),
    ).rejects.toBeInstanceOf(UploadPartsInvalidException);
    expect(storage.signUploadParts).not.toHaveBeenCalled();
  });

  it('recognizes an already completed object and publishes one processing job', async () => {
    const draft = video();
    repository.findOne.mockResolvedValue(draft);
    storage.headSourceIfExists.mockResolvedValue({ contentLength: 100 });
    repository.update.mockResolvedValue({ affected: 1 });
    queue.publish.mockResolvedValue(undefined);

    const result = await service.completeUpload(userId, draft.id, [
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2' },
    ]);

    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(queue.publish).toHaveBeenCalledWith(draft.id);
    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(result.multipart_upload_id).toBeNull();
  });

  it('deletes a completed object whose stored size does not match', async () => {
    const draft = video({ size_bytes: 64 });
    repository.findOne.mockResolvedValue(draft);
    storage.headSourceIfExists.mockResolvedValue(null);
    storage.completeMultipartUpload.mockResolvedValue(undefined);
    storage.headSource.mockResolvedValue({ contentLength: 63 });

    await expect(
      service.completeUpload(userId, draft.id, [
        { partNumber: 1, etag: 'etag-1' },
      ]),
    ).rejects.toBeInstanceOf(UploadSizeMismatchException);
    expect(storage.deleteSource).toHaveBeenCalledWith(draft.source_key);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('compensates PROCESSING back to DRAFT when Redis rejects the job', async () => {
    const draft = video({ size_bytes: 64 });
    repository.findOne.mockResolvedValue(draft);
    storage.headSourceIfExists.mockResolvedValue({ contentLength: 64 });
    repository.update.mockResolvedValue({ affected: 1 });
    queue.publish.mockRejectedValue(new QueueUnavailableException());

    await expect(
      service.completeUpload(userId, draft.id, [
        { partNumber: 1, etag: 'etag-1' },
      ]),
    ).rejects.toBeInstanceOf(QueueUnavailableException);
    expect(repository.update).toHaveBeenLastCalledWith(
      { id: draft.id, status: VideoStatus.PROCESSING },
      {
        status: VideoStatus.DRAFT,
        multipart_upload_id: 'upload-1',
        uploaded_at: null,
      },
    );
  });

  it('cleans storage before deleting a draft with compare-and-set semantics', async () => {
    const draft = video();
    repository.findOne.mockResolvedValue(draft);
    repository.delete.mockResolvedValue({ affected: 1 });

    await service.abortUpload(userId, draft.id);

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      draft.source_key,
      'upload-1',
    );
    expect(storage.deleteSource).toHaveBeenCalledWith(draft.source_key);
    expect(repository.delete).toHaveBeenCalledWith({
      id: draft.id,
      status: VideoStatus.DRAFT,
    });
  });

  it('rejects abort outside DRAFT without touching storage', async () => {
    repository.findOne.mockResolvedValue(
      video({ status: VideoStatus.PROCESSING, multipart_upload_id: null }),
    );

    await expect(
      service.abortUpload(userId, video().id),
    ).rejects.toBeInstanceOf(VideoInvalidStateException);
    expect(storage.deleteSource).not.toHaveBeenCalled();
  });

  it('returns owner-scoped metadata in every lifecycle state', async () => {
    const draft = video();
    repository.findOne.mockResolvedValue(draft);

    await expect(service.findOne(userId, draft.id)).resolves.toBe(draft);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: draft.id, channel: { user_id: userId } },
    });
  });

  it('rejects all media signing before READY without touching storage', async () => {
    const processing = video({
      status: VideoStatus.PROCESSING,
      multipart_upload_id: null,
    });
    repository.findOne.mockResolvedValue(processing);

    await expect(
      service.signThumbnail(userId, processing.id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.signStream(userId, processing.id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    await expect(
      service.signDownload(userId, processing.id),
    ).rejects.toBeInstanceOf(VideoNotReadyException);
    expect(storage.signThumbnail).not.toHaveBeenCalled();
    expect(storage.signStream).not.toHaveBeenCalled();
    expect(storage.signDownload).not.toHaveBeenCalled();
  });

  it('signs READY media using only persisted keys and filename', async () => {
    const ready = video({
      status: VideoStatus.READY,
      multipart_upload_id: null,
      thumbnail_key: 'thumbnails/id/default.jpg',
    });
    repository.findOne.mockResolvedValue(ready);
    const signed = { url: 'http://signed', expiresAt: new Date() };
    storage.signThumbnail.mockResolvedValue(signed);
    storage.signStream.mockResolvedValue(signed);
    storage.signDownload.mockResolvedValue(signed);

    await service.signThumbnail(userId, ready.id);
    await service.signStream(userId, ready.id);
    await service.signDownload(userId, ready.id);

    expect(storage.signThumbnail).toHaveBeenCalledWith(ready.thumbnail_key);
    expect(storage.signStream).toHaveBeenCalledWith(ready.source_key);
    expect(storage.signDownload).toHaveBeenCalledWith(
      ready.source_key,
      ready.original_filename,
    );
  });
});
