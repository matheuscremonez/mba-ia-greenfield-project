import { BadRequestException, ArgumentsHost } from '@nestjs/common';
import { ValidationExceptionFilter } from './validation-exception.filter';

describe('ValidationExceptionFilter', () => {
  let filter: ValidationExceptionFilter;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new ValidationExceptionFilter();
    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnValue({ json: mockJson });

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({ url: '/test', method: 'POST' }),
      }),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({}) as any,
      switchToWs: () => ({}) as any,
      getType: () => 'http',
    } as unknown as ArgumentsHost;
  });

  it('normalizes array of class-validator messages', () => {
    const exception = new BadRequestException({
      message: [
        'email must be an email',
        'password must be longer than or equal to 8 characters',
      ],
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: [
        'email must be an email',
        'password must be longer than or equal to 8 characters',
      ],
    });
  });

  it('wraps single string message into array', () => {
    const exception = new BadRequestException({
      message: 'Invalid input',
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, mockHost);

    expect(mockStatus).toHaveBeenCalledWith(400);
    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'VALIDATION_ERROR',
      message: ['Invalid input'],
    });
  });

  it('uses the multipart-specific code for upload part payloads', () => {
    mockHost.switchToHttp = () =>
      ({
        getResponse: () => ({ status: mockStatus }),
        getRequest: () => ({
          path: '/videos/0e4dc0d0-0925-4cc1-9701-4b29d73255cf/uploads/parts',
          method: 'POST',
        }),
      }) as ReturnType<ArgumentsHost['switchToHttp']>;
    const exception = new BadRequestException({
      message: ['part_numbers must contain at least 1 elements'],
    });

    filter.catch(exception, mockHost);

    expect(mockJson).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'UPLOAD_PARTS_INVALID',
      message: ['part_numbers must contain at least 1 elements'],
    });
  });
});
