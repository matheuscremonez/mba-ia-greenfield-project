import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { createTestDataSource } from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from '../video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await dataSource.query('DELETE FROM "refresh_tokens"');
    await dataSource.query('DELETE FROM "verification_tokens"');
    await dataSource.query('DELETE FROM "channels"');
    await dataSource.query('DELETE FROM "users"');
  });

  async function createChannel(suffix: string): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video-${suffix}@example.com`,
        password: 'hashed',
      }),
    );

    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${suffix}`,
        nickname: `video-${suffix}`,
        user_id: user.id,
      }),
    );
  }

  function draft(channelId: string, suffix: string): Video {
    return videoRepository.create({
      channel_id: channelId,
      title: `Video ${suffix}`,
      original_filename: `${suffix}.mp4`,
      content_type: 'video/mp4',
      size_bytes: 1_024,
      source_bucket: 'streamtube-videos',
      source_key: `videos/${suffix}/source`,
      multipart_upload_id: `upload-${suffix}`,
    });
  }

  it('should generate UUID, DRAFT status and timestamps', async () => {
    const channel = await createChannel('defaults');
    const saved = await videoRepository.save(draft(channel.id, 'defaults'));

    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(saved.status).toBe(VideoStatus.DRAFT);
    expect(saved.created_at).toBeInstanceOf(Date);
    expect(saved.updated_at).toBeInstanceOf(Date);
  });

  it.each([0, 10_737_418_241])(
    'should reject invalid size_bytes %s',
    async (sizeBytes) => {
      const channel = await createChannel(`size-${sizeBytes}`);
      const video = draft(channel.id, `size-${sizeBytes}`);
      video.size_bytes = sizeBytes;

      await expect(videoRepository.save(video)).rejects.toThrow();
    },
  );

  it('should reject unsupported content type', async () => {
    const channel = await createChannel('mime');
    const video = draft(channel.id, 'mime');
    video.content_type = 'application/octet-stream';

    await expect(videoRepository.save(video)).rejects.toThrow();
  });

  it('should persist normalized metadata and numeric duration', async () => {
    const channel = await createChannel('metadata');
    const video = draft(channel.id, 'metadata');
    video.duration_seconds = 12.345;
    video.metadata = {
      format_name: 'mov,mp4',
      bit_rate: 1_200_000,
      video_codec: 'h264',
      audio_codec: 'aac',
      width: 1920,
      height: 1080,
      frame_rate: '30/1',
    };

    const saved = await videoRepository.save(video);
    const found = await videoRepository.findOneByOrFail({ id: saved.id });

    expect(found.duration_seconds).toBe(12.345);
    expect(found.metadata).toEqual(video.metadata);
  });

  it('should enforce source and non-null thumbnail key uniqueness', async () => {
    const firstChannel = await createChannel('unique-1');
    const secondChannel = await createChannel('unique-2');
    const first = draft(firstChannel.id, 'unique-1');
    first.thumbnail_key = 'thumbnails/shared/default.jpg';
    await videoRepository.save(first);

    const duplicateSource = draft(secondChannel.id, 'unique-2');
    duplicateSource.source_key = first.source_key;
    await expect(videoRepository.save(duplicateSource)).rejects.toThrow();

    duplicateSource.source_key = 'videos/unique-2/source';
    duplicateSource.thumbnail_key = first.thumbnail_key;
    await expect(videoRepository.save(duplicateSource)).rejects.toThrow();
  });

  it('should restrict deletion of a referenced channel', async () => {
    const channel = await createChannel('restrict');
    await videoRepository.save(draft(channel.id, 'restrict'));

    await expect(channelRepository.remove(channel)).rejects.toThrow();
  });
});
