import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { SIGNED_URL_EXPIRES_IN_SECONDS } from '../config/storage.config';
import {
  CompleteVideoUploadDto,
  ProcessingVideoResponseDto,
} from './dto/complete-video-upload.dto';
import {
  InitiatedVideoUploadResponseDto,
  InitiateVideoUploadDto,
} from './dto/initiate-video-upload.dto';
import {
  SignedUploadPartsResponseDto,
  SignUploadPartsDto,
} from './dto/sign-upload-parts.dto';
import { VideosService } from './videos.service';
import type { CompletedUploadPart } from './storage/video-storage.types';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideoStatus } from './video-status.enum';

const errorSchema = { $ref: getSchemaPath(ApiErrorEnvelope) };

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Initialize a multipart video upload' })
  @ApiResponse({ status: 201, type: InitiatedVideoUploadResponseDto })
  @ApiResponse({ status: 400, schema: errorSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 413, schema: errorSchema })
  @ApiResponse({ status: 415, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async initiateUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitiateVideoUploadDto,
  ): Promise<InitiatedVideoUploadResponseDto> {
    const result = await this.videosService.initiateUpload(user.sub, {
      title: dto.title,
      originalFilename: dto.original_filename,
      contentType: dto.content_type,
      sizeBytes: dto.size_bytes,
    });
    return {
      id: result.video.id,
      status: result.video.status,
      upload: {
        upload_id: result.upload.uploadId,
        part_size_bytes: result.upload.partSizeBytes,
        part_count: result.upload.partCount,
        expires_in_seconds: SIGNED_URL_EXPIRES_IN_SECONDS,
      },
    };
  }

  @Post(':id/uploads/parts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign selected multipart upload parts' })
  @ApiResponse({ status: 200, type: SignedUploadPartsResponseDto })
  @ApiResponse({ status: 400, schema: errorSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async signUploadParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SignUploadPartsDto,
  ): Promise<SignedUploadPartsResponseDto> {
    const parts = await this.videosService.signUploadParts(
      user.sub,
      id,
      dto.part_numbers,
    );
    return {
      parts: parts.map((part) => ({
        part_number: part.partNumber,
        url: part.url,
        expires_at: part.expiresAt.toISOString(),
      })),
    };
  }

  @Post(':id/uploads/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Complete a multipart upload and schedule processing',
  })
  @ApiResponse({ status: 202, type: ProcessingVideoResponseDto })
  @ApiResponse({ status: 400, schema: errorSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 422, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<ProcessingVideoResponseDto> {
    const parts = Array.isArray(dto.parts)
      ? dto.parts.map((part) => ({
          partNumber: part.part_number,
          etag: part.etag,
        }))
      : (dto.parts as unknown as CompletedUploadPart[]);
    const video = await this.videosService.completeUpload(user.sub, id, parts);
    return { id: video.id, status: video.status };
  }

  @Delete(':id/uploads')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Abort a draft multipart video upload' })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({ status: 400, schema: errorSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get owner-scoped video metadata' })
  @ApiResponse({ status: 200, type: VideoResponseDto })
  @ApiResponse({ status: 400, schema: errorSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VideoResponseDto> {
    const video = await this.videosService.findOne(user.sub, id);
    const ready = video.status === VideoStatus.READY;
    return {
      id: video.id,
      title: video.title,
      status: video.status,
      original_filename: video.original_filename,
      content_type: video.content_type,
      size_bytes: video.size_bytes,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      processing_error:
        video.status === VideoStatus.ERROR ? video.processing_error : null,
      thumbnail_url:
        ready && video.thumbnail_key ? `/videos/${video.id}/thumbnail` : null,
      stream_url: ready ? `/videos/${video.id}/stream` : null,
      download_url: ready ? `/videos/${video.id}/download` : null,
      created_at: video.created_at,
      updated_at: video.updated_at,
      uploaded_at: video.uploaded_at,
      processed_at: video.processed_at,
    };
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Redirect to the private video thumbnail' })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to a signed private JPEG URL',
    headers: { Location: { schema: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async thumbnail(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const signed = await this.videosService.signThumbnail(user.sub, id);
    response.status(HttpStatus.TEMPORARY_REDIRECT).location(signed.url);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Redirect to the private streamable source' })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect preserving optional Range headers',
    headers: { Location: { schema: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async stream(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const signed = await this.videosService.signStream(user.sub, id);
    response.status(HttpStatus.TEMPORARY_REDIRECT).location(signed.url);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Redirect to the private source as an attachment' })
  @ApiResponse({
    status: 307,
    description: 'Temporary redirect to a signed attachment URL',
    headers: { Location: { schema: { type: 'string', format: 'uri' } } },
  })
  @ApiResponse({ status: 401, schema: errorSchema })
  @ApiResponse({ status: 404, schema: errorSchema })
  @ApiResponse({ status: 409, schema: errorSchema })
  @ApiResponse({ status: 503, schema: errorSchema })
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const signed = await this.videosService.signDownload(user.sub, id);
    response.status(HttpStatus.TEMPORARY_REDIRECT).location(signed.url);
  }
}
