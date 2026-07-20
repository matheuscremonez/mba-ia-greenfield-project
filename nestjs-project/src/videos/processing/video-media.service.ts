import { Inject, Injectable } from '@nestjs/common';
import { PROCESS_COMMAND_RUNNER } from './video-media.tokens';
import type {
  ProbedVideoMedia,
  ProcessCommandRunner,
} from './video-media.types';

interface ProbeStream {
  codec_type?: unknown;
  codec_name?: unknown;
  width?: unknown;
  height?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
}

interface ProbeDocument {
  format?: { duration?: unknown; format_name?: unknown; bit_rate?: unknown };
  streams?: ProbeStream[];
}

@Injectable()
export class VideoMediaService {
  constructor(
    @Inject(PROCESS_COMMAND_RUNNER)
    private readonly runCommand: ProcessCommandRunner,
  ) {}

  async probe(sourcePath: string): Promise<ProbedVideoMedia> {
    const { stdout } = await this.runCommand('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      sourcePath,
    ]);

    let document: ProbeDocument;
    try {
      document = JSON.parse(stdout) as ProbeDocument;
    } catch {
      throw new Error('ffprobe returned malformed metadata');
    }

    const video = document.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    const audio = document.streams?.find(
      (stream) => stream.codec_type === 'audio',
    );
    const durationSeconds = Number(document.format?.duration);
    const width = Number(video?.width);
    const height = Number(video?.height);
    const videoCodec = video?.codec_name;
    const formatName = document.format?.format_name;
    const frameRate = video?.avg_frame_rate ?? video?.r_frame_rate;

    if (
      !video ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 0 ||
      !Number.isInteger(width) ||
      width <= 0 ||
      !Number.isInteger(height) ||
      height <= 0 ||
      typeof videoCodec !== 'string' ||
      typeof formatName !== 'string' ||
      typeof frameRate !== 'string'
    ) {
      throw new Error('Video metadata is incomplete or invalid');
    }

    const parsedBitRate = Number(document.format?.bit_rate);
    return {
      durationSeconds,
      metadata: {
        format_name: formatName,
        bit_rate:
          Number.isFinite(parsedBitRate) && parsedBitRate >= 0
            ? parsedBitRate
            : null,
        video_codec: videoCodec,
        audio_codec:
          typeof audio?.codec_name === 'string' ? audio.codec_name : null,
        width,
        height,
        frame_rate: frameRate,
      },
    };
  }

  async generateThumbnail(
    sourcePath: string,
    thumbnailPath: string,
  ): Promise<void> {
    await this.runCommand('ffmpeg', [
      '-y',
      '-ss',
      '0',
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-q:v',
      '2',
      thumbnailPath,
    ]);
  }
}
