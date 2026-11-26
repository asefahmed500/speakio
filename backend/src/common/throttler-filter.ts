import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

/**
 * Return a stable, user-facing 429 payload instead of Nest's raw
 * "ThrottlerException: Too Many Requests" message leaking the exception class
 * name to clients. All other exceptions keep Nest's default handling.
 */
@Catch(ThrottlerException)
export class ThrottlerFilter implements ExceptionFilter {
  catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const request = context.getRequest<{ requestId?: string }>();

    response.status(429).json({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many requests. Please wait a moment and try again.',
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
  }
}
