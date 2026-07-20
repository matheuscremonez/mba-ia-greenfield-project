import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { VideoStatus } from '../video-status.enum';

export class CompleteUploadPartDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  part_number: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteVideoUploadDto {
  @ApiProperty({ type: [CompleteUploadPartDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadPartDto)
  parts: CompleteUploadPartDto[];
}

export class ProcessingVideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: [VideoStatus.PROCESSING] })
  status: VideoStatus;
}
