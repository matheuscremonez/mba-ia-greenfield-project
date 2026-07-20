import { ApiProperty } from '@nestjs/swagger';
import { VideoMetadata } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';

export class VideoMetadataDto implements VideoMetadata {
  @ApiProperty()
  format_name: string;

  @ApiProperty({ nullable: true, type: Number })
  bit_rate: number | null;

  @ApiProperty()
  video_codec: string;

  @ApiProperty({ nullable: true, type: String })
  audio_codec: string | null;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;

  @ApiProperty()
  frame_rate: string;
}

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty()
  original_filename: string;

  @ApiProperty()
  content_type: string;

  @ApiProperty({ maximum: 10_737_418_240 })
  size_bytes: number;

  @ApiProperty({ nullable: true, type: Number })
  duration_seconds: number | null;

  @ApiProperty({ nullable: true, type: VideoMetadataDto })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ nullable: true, type: String })
  processing_error: string | null;

  @ApiProperty({ nullable: true, type: String })
  thumbnail_url: string | null;

  @ApiProperty({ nullable: true, type: String })
  stream_url: string | null;

  @ApiProperty({ nullable: true, type: String })
  download_url: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ format: 'date-time' })
  updated_at: Date;

  @ApiProperty({ nullable: true, format: 'date-time', type: String })
  uploaded_at: Date | null;

  @ApiProperty({ nullable: true, format: 'date-time', type: String })
  processed_at: Date | null;
}
