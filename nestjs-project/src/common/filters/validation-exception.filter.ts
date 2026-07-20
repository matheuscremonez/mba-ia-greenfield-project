import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { Response } from 'express';
import { Request } from 'express';

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const exceptionResponse = exception.getResponse() as Record<
      string,
      unknown
    >;

    const raw = exceptionResponse['message'];
    const message = Array.isArray(raw) ? raw : [raw];
    const isUploadPartsValidation =
      request.method === 'POST' &&
      /\/videos\/[^/]+\/uploads\/(parts|complete)$/.test(request.path) &&
      !message.some(
        (item) => typeof item === 'string' && item.includes('UUID'),
      );

    response.status(400).json({
      statusCode: 400,
      error: isUploadPartsValidation
        ? 'UPLOAD_PARTS_INVALID'
        : 'VALIDATION_ERROR',
      message,
    });
  }
}
