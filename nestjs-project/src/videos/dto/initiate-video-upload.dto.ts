import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { VideoStatus } from '../video-status.enum';

export class InitiateVideoUploadDto {
  @ApiProperty({ example: 'My first video', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'video.mp4', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^/\\\p{Cc}]+$/u)
  original_filename: string;

  @ApiProperty({
    enum: ['video/mp4', 'video/webm', 'video/quicktime'],
    example: 'video/mp4',
  })
  @IsString()
  @IsNotEmpty()
  content_type: string;

  @ApiProperty({ example: 1048576, minimum: 1, maximum: 10737418240 })
  @IsInt()
  @Min(1)
  size_bytes: number;
}

export class InitiatedUploadDetailsDto {
  @ApiProperty()
  upload_id: string;

  @ApiProperty({ example: 67_108_864 })
  part_size_bytes: number;

  @ApiProperty({ example: 1 })
  part_count: number;

  @ApiProperty({ example: 900 })
  expires_in_seconds: number;
}

export class InitiatedVideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: [VideoStatus.DRAFT] })
  status: VideoStatus;

  @ApiProperty({ type: InitiatedUploadDetailsDto })
  upload: InitiatedUploadDetailsDto;
}
