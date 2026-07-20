import { VideoMetadata } from '../entities/video.entity';

export interface ProbedVideoMedia {
  durationSeconds: number;
  metadata: VideoMetadata;
}

export type ProcessCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;
