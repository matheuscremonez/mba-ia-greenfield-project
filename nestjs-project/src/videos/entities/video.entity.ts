import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from '../video-status.enum';

export interface VideoMetadata {
  format_name: string;
  bit_rate: number | null;
  video_codec: string;
  audio_codec: string | null;
  width: number;
  height: number;
  frame_rate: string;
}

const numberTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};

@Entity('videos')
@Check('CHK_VIDEOS_TITLE', 'char_length(btrim("title")) BETWEEN 1 AND 255')
@Check(
  'CHK_VIDEOS_SIZE_BYTES',
  '"size_bytes" > 0 AND "size_bytes" <= 10737418240',
)
@Check(
  'CHK_VIDEOS_CONTENT_TYPE',
  "\"content_type\" IN ('video/mp4', 'video/webm', 'video/quicktime')",
)
@Check(
  'CHK_VIDEOS_DURATION_SECONDS',
  '"duration_seconds" IS NULL OR "duration_seconds" >= 0',
)
@Index('IDX_VIDEOS_CHANNEL_ID', ['channel_id'])
@Index('IDX_VIDEOS_STATUS', ['status'])
@Index('UQ_VIDEOS_SOURCE_KEY', ['source_key'], { unique: true })
@Index('UQ_VIDEOS_THUMBNAIL_KEY', ['thumbnail_key'], {
  unique: true,
  where: '"thumbnail_key" IS NOT NULL',
})
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'video_status',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 127 })
  content_type: string;

  @Column({ type: 'bigint', transformer: numberTransformer })
  size_bytes: number;

  @Column({ type: 'varchar', length: 63 })
  source_bucket: string;

  @Column({ type: 'varchar', length: 1024 })
  source_key: string;

  @Column({ type: 'varchar', length: 63, nullable: true })
  thumbnail_bucket: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  multipart_upload_id: string | null;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    nullable: true,
    transformer: numberTransformer,
  })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  processing_error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  uploaded_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
