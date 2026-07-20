import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteVideoUploadDto } from './complete-video-upload.dto';
import { InitiateVideoUploadDto } from './initiate-video-upload.dto';
import { SignUploadPartsDto } from './sign-upload-parts.dto';

describe('video upload DTOs', () => {
  it('accepts valid initialization metadata without lossy size conversion', async () => {
    const dto = plainToInstance(InitiateVideoUploadDto, {
      title: 'Video',
      original_filename: 'video.mp4',
      content_type: 'video/mp4',
      size_bytes: 10_737_418_240,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.size_bytes).toBe(10_737_418_240);
  });

  it('rejects paths, control characters and non-integer sizes', async () => {
    const dto = plainToInstance(InitiateVideoUploadDto, {
      title: 'Video',
      original_filename: '../video\n.mp4',
      content_type: 'video/mp4',
      size_bytes: 1.5,
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['original_filename', 'size_bytes']),
    );
  });

  it('rejects empty, duplicate, oversized and non-integer signing batches', async () => {
    const invalidValues = [
      [],
      [1, 1],
      Array.from({ length: 21 }, (_, index) => index + 1),
      [1, 1.5],
    ];

    for (const partNumbers of invalidValues) {
      const dto = plainToInstance(SignUploadPartsDto, {
        part_numbers: partNumbers,
      });
      await expect(validate(dto)).resolves.not.toHaveLength(0);
    }
  });

  it('validates nested completion parts', async () => {
    const valid = plainToInstance(CompleteVideoUploadDto, {
      parts: [{ part_number: 1, etag: 'etag-1' }],
    });
    const invalid = plainToInstance(CompleteVideoUploadDto, {
      parts: [{ part_number: 0, etag: '' }],
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    const [partsError] = await validate(invalid);
    expect(partsError.children?.[0].children).toHaveLength(2);
  });
});
