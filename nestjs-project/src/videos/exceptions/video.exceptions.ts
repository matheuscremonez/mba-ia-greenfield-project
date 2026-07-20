import { DomainException } from '../../common/exceptions/domain.exception';

export class StorageUnavailableException extends DomainException {
  constructor() {
    super(
      'STORAGE_UNAVAILABLE',
      503,
      'Video storage is temporarily unavailable',
    );
  }
}

export class QueueUnavailableException extends DomainException {
  constructor() {
    super(
      'QUEUE_UNAVAILABLE',
      503,
      'Video processing queue is temporarily unavailable',
    );
  }
}

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class VideoInvalidStateException extends DomainException {
  constructor() {
    super(
      'VIDEO_INVALID_STATE',
      409,
      'Video operation is not permitted in its current state',
    );
  }
}

export class UploadPartsInvalidException extends DomainException {
  constructor() {
    super('UPLOAD_PARTS_INVALID', 400, 'Multipart upload parts are invalid');
  }
}

export class UploadSizeMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOAD_SIZE_MISMATCH',
      422,
      'Uploaded object size does not match the declared size',
    );
  }
}

export class VideoTooLargeException extends DomainException {
  constructor() {
    super('VIDEO_TOO_LARGE', 413, 'Video exceeds the 10 GiB size limit');
  }
}

export class VideoTypeUnsupportedException extends DomainException {
  constructor() {
    super('VIDEO_TYPE_UNSUPPORTED', 415, 'Video content type is unsupported');
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video media is not ready');
  }
}
