import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(WorkerModule);
  application.enableShutdownHooks();
  Logger.log('Video processing worker started', 'WorkerBootstrap');
}

void bootstrap();
