import { VideoMediaService } from './video-media.service';
import { ProcessCommandRunner } from './video-media.types';

describe('VideoMediaService', () => {
  let runner: jest.MockedFunction<ProcessCommandRunner>;
  let service: VideoMediaService;

  beforeEach(() => {
    runner = jest.fn();
    service = new VideoMediaService(runner);
  });

  it('normalizes ffprobe format, video and optional audio metadata', async () => {
    runner.mockResolvedValue({
      stdout: JSON.stringify({
        format: {
          duration: '12.345',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
          bit_rate: '1200000',
        },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30/1',
          },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
      stderr: '',
    });

    await expect(service.probe('/tmp/source')).resolves.toEqual({
      durationSeconds: 12.345,
      metadata: {
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        bit_rate: 1_200_000,
        video_codec: 'h264',
        audio_codec: 'aac',
        width: 1920,
        height: 1080,
        frame_rate: '30/1',
      },
    });
    expect(runner).toHaveBeenCalledWith('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      '/tmp/source',
    ]);
  });

  it.each([
    ['malformed JSON', '{'],
    [
      'missing video stream',
      JSON.stringify({
        format: { duration: '1', format_name: 'mp4' },
        streams: [],
      }),
    ],
  ])('rejects %s', async (_case, stdout) => {
    runner.mockResolvedValue({ stdout, stderr: '' });
    await expect(service.probe('/tmp/source')).rejects.toThrow();
  });

  it('keeps missing optional audio and bitrate as null', async () => {
    runner.mockResolvedValue({
      stdout: JSON.stringify({
        format: { duration: '1', format_name: 'webm', bit_rate: 'N/A' },
        streams: [
          {
            codec_type: 'video',
            codec_name: 'vp9',
            width: 640,
            height: 360,
            r_frame_rate: '24/1',
          },
        ],
      }),
      stderr: '',
    });

    const result = await service.probe('/tmp/source');
    expect(result.metadata.audio_codec).toBeNull();
    expect(result.metadata.bit_rate).toBeNull();
  });

  it('runs ffmpeg with an argument array and deterministic JPEG output', async () => {
    runner.mockResolvedValue({ stdout: '', stderr: '' });

    await service.generateThumbnail('/tmp/source', '/tmp/thumbnail.jpg');

    expect(runner).toHaveBeenCalledWith('ffmpeg', [
      '-y',
      '-ss',
      '0',
      '-i',
      '/tmp/source',
      '-frames:v',
      '1',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-q:v',
      '2',
      '/tmp/thumbnail.jpg',
    ]);
  });
});
