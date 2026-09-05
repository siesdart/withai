import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
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
import type { Result } from 'neverthrow';
import { map, type Observable } from 'rxjs';
import { match } from 'ts-pattern';

import { retryAfterSeconds } from './cooldown/cooldown';
import { CreateDiscussionTimeAdjustmentDto } from './dto/create-discussion-time-adjustment.dto';
import { CreateMafiaChatDto } from './dto/create-mafia-chat.dto';
import { CreateMafiaSessionDto } from './dto/create-mafia-session.dto';
import { CreateNominationDto } from './dto/create-nomination.dto';
import { CreatePublicSpeechDto } from './dto/create-public-speech.dto';
import { CreateVerdictDto } from './dto/create-verdict.dto';
import { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import { type GameSessionError, GameSessionsService } from './game-sessions.service';
import {
  OptionalIdempotencyKey,
  RequiredIdempotencyKey,
} from './idempotency/idempotency-key.decorator';

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
    @OptionalIdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService
        .createMafiaSession(request.headers.cookie, body.participantCount, idempotencyKey)
        .map(({ holderId, projection }) => {
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
        }),
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
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitPublicSpeech(
        sessionId,
        request.headers.cookie,
        body.content,
        idempotencyKey,
      ),
      response,
    );
  }

  @Post(':sessionId/actions/mafia-chat')
  @ApiOperation({ summary: 'Submit a private Mafia Chat statement during Night' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateMafiaChatDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  submitMafiaChat(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateMafiaChatDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitMafiaChat(
        sessionId,
        request.headers.cookie,
        body.content,
        idempotencyKey,
      ),
      response,
    );
  }

  @Post(':sessionId/actions/nomination')
  @ApiOperation({ summary: 'Nominate a living Participant for Final Defence' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The nomination is not permitted in the current Phase.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  submitNomination(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitNomination(
        sessionId,
        request.headers.cookie,
        body.targetParticipantId,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/final-defence')
  @ApiOperation({ summary: 'Submit the nominated Human Player Final Defence' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreatePublicSpeechDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({
    description: 'The Human Player is not eligible to make a Final Defence.',
  })
  @ApiTooManyRequestsResponse({
    description: 'The Final Defence speech cooldown is active.',
    headers: {
      'Retry-After': {
        description: 'Seconds until another Final Defence statement may be submitted.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  submitFinalDefence(
    @Param('sessionId') sessionId: string,
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitFinalDefence(
        sessionId,
        request.headers.cookie,
        body.content,
        idempotencyKey,
      ),
      response,
    );
  }

  @Post(':sessionId/actions/verdict')
  @ApiOperation({ summary: 'Submit the Human Player verdict vote' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateVerdictDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The verdict is not permitted in the current Phase.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  submitVerdict(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateVerdictDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitVerdict(
        sessionId,
        request.headers.cookie,
        body.vote,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/mafia-target')
  @ApiOperation({ summary: 'Submit the Human Player private Mafia target' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  submitMafiaTarget(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitMafiaTarget(
        sessionId,
        request.headers.cookie,
        body.targetParticipantId,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/doctor-protection')
  @ApiOperation({ summary: 'Submit the Human Player private Doctor protection' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  submitDoctorProtection(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitDoctorProtection(
        sessionId,
        request.headers.cookie,
        body.targetParticipantId,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/detective-investigation')
  @ApiOperation({ summary: 'Submit the Human Player private Detective investigation' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  submitDetectiveInvestigation(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitDetectiveInvestigation(
        sessionId,
        request.headers.cookie,
        body.targetParticipantId,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/discussion-time-adjustment')
  @ApiOperation({ summary: 'Adjust the Discussion deadline for the Human Player' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateDiscussionTimeAdjustmentDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The Discussion Phase cannot be adjusted.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  @ApiTooManyRequestsResponse({
    description: 'The Human Player must wait before adjusting the Discussion time again.',
    headers: {
      'Retry-After': {
        description: 'Seconds until another Discussion Time Adjustment may be submitted.',
        schema: { type: 'integer', minimum: 1 },
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  adjustDiscussionTime(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateDiscussionTimeAdjustmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.adjustDiscussionTime(
        sessionId,
        request.headers.cookie,
        body.adjustmentSeconds,
        body.expectedDeadline,
        idempotencyKey,
      ),
      response,
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
    const events = this.resolveGameSessionResult(
      this.gameSessionsService.eventsFor(
        sessionId,
        request.headers.cookie,
        this.lastEventId(request.headers['last-event-id']),
      ),
    );
    return events.pipe(
      map((projection) => ({
        id: String(projection.eventId),
        type: 'snapshot',
        data: projection,
      })),
    );
  }

  private projectionFor(sessionId: string, cookie: string | undefined) {
    return this.resolveGameSessionResult(this.gameSessionsService.getProjection(sessionId, cookie));
  }

  private resolveGameSessionResult<Value>(
    result: Result<Value, GameSessionError>,
    response?: Response,
  ): Value {
    return result.match(
      (value) => value,
      (error) => {
        this.setRetryAfterHeader(response, error);
        throw this.toHttpException(error);
      },
    );
  }

  private setRetryAfterHeader(response: Response | undefined, error: GameSessionError) {
    if (!response) return;

    const retryAfterMs = match(error)
      .with(
        { type: 'public-speech-rate-limited' },
        { type: 'day-action-rate-limited' },
        { type: 'discussion-time-adjustment-rate-limited' },
        (rateLimitError) => rateLimitError.retryAfterMs,
      )
      .otherwise(() => undefined);
    if (retryAfterMs) {
      response.setHeader('Retry-After', String(retryAfterSeconds(retryAfterMs)));
    }
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
        { type: 'mafia-chat-idempotency-conflict' },
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
        { type: 'invalid-mafia-chat' },
        () => new BadRequestException('This Mafia Chat action is not permitted.'),
      )
      .with(
        { type: 'invalid-day-action' },
        () => new BadRequestException('This Day action is not permitted in the current Phase.'),
      )
      .with(
        { type: 'day-action-idempotency-conflict' },
        () =>
          new HttpException(
            'The Idempotency-Key was already used with a different action.',
            HttpStatus.CONFLICT,
          ),
      )
      .with(
        { type: 'day-action-rate-limited' },
        () =>
          new HttpException(
            'Please wait before submitting another Final Defence statement.',
            HttpStatus.TOO_MANY_REQUESTS,
          ),
      )
      .with(
        { type: 'discussion-time-adjustment-idempotency-conflict' },
        () =>
          new HttpException(
            'The Idempotency-Key was already used with a different action.',
            HttpStatus.CONFLICT,
          ),
      )
      .with(
        { type: 'discussion-time-adjustment-rate-limited' },
        () =>
          new HttpException(
            'Please wait before adjusting the Discussion time again.',
            HttpStatus.TOO_MANY_REQUESTS,
          ),
      )
      .with(
        { type: 'invalid-discussion-time-adjustment' },
        () => new BadRequestException('The Discussion Phase cannot be adjusted.'),
      )
      .with(
        { type: 'stale-discussion-time-adjustment' },
        () =>
          new HttpException(
            'The Discussion Phase changed before the adjustment could be applied.',
            HttpStatus.CONFLICT,
          ),
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
