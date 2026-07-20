import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { envValidationSchema } from './config/env.validation';
import queueConfig from './config/queue.config';
import storageConfig from './config/storage.config';
import { Video } from './videos/entities/video.entity';
import { Channel } from './channels/entities/channel.entity';
import { User } from './users/entities/user.entity';
import { VideoProcessor } from './videos/processors/video.processor';
import { videoMediaProviders } from './videos/processing/video-media.providers';
import { VideoMediaService } from './videos/processing/video-media.service';
import { VIDEO_PROCESSING_QUEUE } from './videos/queue/video-processing.queue';
import { videoStorageProviders } from './videos/storage/video-storage.providers';
import { VideoStorageService } from './videos/storage/video-storage.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (database: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: database.host,
        port: database.port,
        username: database.username,
        password: database.password,
        database: database.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video, Channel, User]),
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: queue.workerConnection,
      }),
    }),
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
  ],
  providers: [
    ...videoStorageProviders,
    ...videoMediaProviders,
    VideoStorageService,
    VideoMediaService,
    VideoProcessor,
  ],
})
export class WorkerModule {}
