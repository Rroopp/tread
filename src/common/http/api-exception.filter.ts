import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId: string }>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      this.logger.error(
        `Unhandled request ${request.requestId} ${request.method} ${request.path}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const details = this.getDetails(exception, status);
    response.status(status).json({
      error: {
        code: this.codeFor(status),
        message: status >= 500 ? 'Internal server error' : details.message,
        ...(details.fields ? { fields: details.fields } : {}),
      },
      request_id: request.requestId,
    });
  }

  private getDetails(exception: unknown, status: number): { message: string; fields?: string[] } {
    if (!(exception instanceof HttpException)) return { message: 'Internal server error' };
    const body = exception.getResponse();
    if (typeof body === 'string') return { message: body };
    if (typeof body !== 'object' || body === null) return { message: 'Request failed' };

    const message = 'message' in body ? body.message : undefined;
    if (Array.isArray(message)) {
      return { message: 'Request validation failed', fields: message.map(String) };
    }
    if (typeof message === 'string') return { message };
    return { message: status >= 500 ? 'Internal server error' : 'Request failed' };
  }

  private codeFor(status: number): string {
    switch (status) {
      case 400: return 'INVALID_REQUEST';
      case 401: return 'UNAUTHENTICATED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'VALIDATION_ERROR';
      case 429: return 'RATE_LIMITED';
      case 503: return 'SERVICE_UNAVAILABLE';
      default: return status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR';
    }
  }
}
