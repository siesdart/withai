import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';

const minimumIdempotencyKeyLength = 16;
const maximumIdempotencyKeyLength = 200;

const idempotencyKeyFromRequest = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ headers: { 'idempotency-key'?: string } }>().headers[
      'idempotency-key'
    ],
);

class OptionalIdempotencyKeyPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined) {
    return value === undefined ? undefined : validIdempotencyKey(value);
  }
}

class RequiredIdempotencyKeyPipe implements PipeTransform<string | undefined, string> {
  transform(value: string | undefined) {
    return validIdempotencyKey(value);
  }
}

export function OptionalIdempotencyKey() {
  return idempotencyKeyFromRequest(new OptionalIdempotencyKeyPipe());
}

export function RequiredIdempotencyKey() {
  return idempotencyKeyFromRequest(new RequiredIdempotencyKeyPipe());
}

function validIdempotencyKey(value: string | undefined) {
  if (
    !value ||
    value.length < minimumIdempotencyKeyLength ||
    value.length > maximumIdempotencyKeyLength
  ) {
    throw new BadRequestException('The Idempotency-Key header is invalid.');
  }

  return value;
}
