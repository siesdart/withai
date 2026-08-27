import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { match } from 'ts-pattern';

import { CreateMafiaSessionDto } from './dto/create-mafia-session.dto';
import { CreatePublicSpeechDto } from './dto/create-public-speech.dto';
import { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import { type GameSessionError, GameSessionsService } from './game-sessions.service';

@ApiTags('Game Sessions')
@Controller('game-sessions')
export class GameSessionsController {
  constructor(private readonly gameSessionsService: GameSessionsService) {}

  @Post('mafia')
  @ApiOperation({ summary: 'Create an anonymous Mafia Game Session' })
  @ApiBody({ type: CreateMafiaSessionDto })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'A client-generated key that makes a Game Session creation retry safe.',
  })
  @ApiBadRequestResponse({
    description: 'The Idempotency-Key header is invalid or the request body fails validation.',
  })
  @ApiCreatedResponse({
    description: 'The initial authorized projection and a signed anonymous guest cookie.',
    type: MafiaGameSessionProjectionEntity,
  })
  @ApiTooManyRequestsResponse({ description: 'The Guest Play Allowance is exhausted for today.' })
  @ApiConflictResponse({
    description: 'The Idempotency-Key was already used with a different request.',
  })
  createMafiaSession(
    @Body() body: CreateMafiaSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 200)) {
      throw new BadRequestException('The Idempotency-Key header is invalid.');
    }
    return this.gameSessionsService
      .createMafiaSession(request.headers.cookie, body.participantCount, idempotencyKey)
      .match(
        ({ holderId, projection }) => {
          response.cookie(
            this.gameSessionsService.guestCookieName(),
            this.gameSessionsService.signGuestId(holderId),
            {
              httpOnly: true,
              sameSite: 'strict',
              secure: process.env.NODE_ENV === 'production',
            },
          );
          return projection;
        },
        (error) => {
          throw this.toHttpException(error);
        },
      );
  }

  @Get(':sessionId/snapshot')
  @ApiOperation({ summary: 'Get the current authorized Game Session snapshot' })
  @ApiCookieAuth('withai_guest')
  @ApiOkResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  snapshot(@Param('sessionId') sessionId: string, @Req() request: Request) {
    return this.projectionFor(sessionId, request.headers.cookie);
  }

  @Post(':sessionId/actions/public-speech')
  @ApiOperation({ summary: 'Submit Public Chat speech for the Human Player' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreatePublicSpeechDto })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'A client-generated key that makes a public action retry safe.',
  })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The public speech is invalid or no longer permitted.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  @ApiTooManyRequestsResponse({
    description: 'The Human Player must wait before submitting another public speech.',
    headers: {
      'Retry-After': {
        description: 'Seconds until another public speech may be submitted.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  submitPublicSpeech(
    @Param('sessionId') sessionId: string,
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      throw new BadRequestException('The Idempotency-Key header is invalid.');
    }

    return this.gameSessionsService
      .submitPublicSpeech(sessionId, request.headers.cookie, body.content, idempotencyKey)
      .match(
        (projection) => projection,
        (error) => {
          if (error.type === 'public-speech-rate-limited') {
            response.setHeader('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)));
            throw new HttpException(
              'Please wait before submitting another public speech.',
              HttpStatus.TOO_MANY_REQUESTS,
            );
          }
          throw this.toHttpException(error);
        },
      );
  }

  @Sse(':sessionId/events')
  @Header('Cache-Control', 'no-cache')
  @ApiOperation({ summary: 'Subscribe to ordered Game Session SSE events' })
  @ApiCookieAuth('withai_guest')
  @ApiResponse({
    status: 200,
    description:
      'A text/event-stream of authorized snapshots. Event IDs are monotonically increasing.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  events(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Observable<{ id: string; type: string; data: object }> {
    return this.gameSessionsService
      .eventsFor(
        sessionId,
        request.headers.cookie,
        this.lastEventId(request.headers['last-event-id']),
      )
      .match(
        (events) =>
          events.pipe(
            map((projection) => ({
              id: String(projection.eventId),
              type: 'snapshot',
              data: projection,
            })),
          ),
        (error) => {
          throw this.toHttpException(error);
        },
      );
  }

  private projectionFor(sessionId: string, cookie: string | undefined) {
    return this.gameSessionsService.getProjection(sessionId, cookie).match(
      (projection) => projection,
      (error) => {
        throw this.toHttpException(error);
      },
    );
  }

  private toHttpException(error: GameSessionError): HttpException {
    return match(error)
      .with(
        { type: 'idempotency-conflict' },
        () =>
          new HttpException(
            'The Idempotency-Key was already used with a different request.',
            HttpStatus.CONFLICT,
          ),
      )
      .with(
        { type: 'guest-allowance-exhausted' },
        () =>
          new HttpException(
            'Your Guest Play Allowance is exhausted for today.',
            HttpStatus.TOO_MANY_REQUESTS,
          ),
      )
      .with(
        { type: 'invalid-mafia-session-input' },
        () => new BadRequestException('The Mafia Game Session input is invalid.'),
      )
      .with(
        { type: 'unavailable-to-guest' },
        () => new ForbiddenException('This Game Session is not available to this guest.'),
      )
      .with(
        { type: 'session-not-found' },
        () => new ForbiddenException('This Game Session is not available to this guest.'),
      )
      .with(
        { type: 'invalid-mafia-projection' },
        () =>
          new HttpException('The Game Session is unavailable.', HttpStatus.INTERNAL_SERVER_ERROR),
      )
      .with(
        { type: 'public-speech-idempotency-conflict' },
        () =>
          new HttpException(
            'The Idempotency-Key was already used with a different action.',
            HttpStatus.CONFLICT,
          ),
      )
      .with(
        { type: 'public-speech-rate-limited' },
        () =>
          new HttpException(
            'Please wait before submitting another public speech.',
            HttpStatus.TOO_MANY_REQUESTS,
          ),
      )
      .with(
        { type: 'invalid-public-speech' },
        () => new BadRequestException('This public action is not permitted.'),
      )
      .with(
        { type: 'expired-phase' },
        () => new BadRequestException('The current Phase has expired.'),
      )
      .with(
        { type: 'dead-participant' },
        () => new BadRequestException('Eliminated Participants cannot take public actions.'),
      )
      .exhaustive();
  }

  private lastEventId(value: string | string[] | undefined) {
    if (typeof value !== 'string') {
      return undefined;
    }

    const eventId = Number.parseInt(value, 10);
    return Number.isSafeInteger(eventId) && eventId >= 0 ? eventId : undefined;
  }
}
