import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import { videoStorageProviders } from './storage/video-storage.providers';
import { VideoStorageService } from './storage/video-storage.service';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessingQueue,
} from './queue/video-processing.queue';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    ConfigModule.forFeature(storageConfig),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
  ],
  providers: [
    ...videoStorageProviders,
    VideoStorageService,
    VideoProcessingQueue,
    VideosService,
  ],
  controllers: [VideosController],
  exports: [
    TypeOrmModule,
    VideoStorageService,
    VideoProcessingQueue,
    VideosService,
  ],
})
export class VideosModule {}
