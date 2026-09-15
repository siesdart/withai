import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Result } from 'neverthrow';
import type { Subscription } from 'rxjs';
import { match } from 'ts-pattern';

import { retryAfterSeconds } from '../application/cooldown/cooldown.js';
import { gameSessionsConfig } from '../application/game-sessions.config.js';
import {
  type GameSessionError,
  GameSessionsService,
} from '../application/game-sessions.service.js';
import { CreateDiscussionTimeAdjustmentDto } from './dto/create-discussion-time-adjustment.dto.js';
import { CreateMafiaChatDto } from './dto/create-mafia-chat.dto.js';
import { CreateMafiaSessionDto } from './dto/create-mafia-session.dto.js';
import { CreateNominationDto } from './dto/create-nomination.dto.js';
import { CreatePublicSpeechDto } from './dto/create-public-speech.dto.js';
import { CreateVerdictDto } from './dto/create-verdict.dto.js';
import { createGuestCookieSigner, guestCookieSecret } from './guest-cookie.js';
import { OptionalIdempotencyKey, RequiredIdempotencyKey } from './idempotency-key.decorator.js';
import { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity.js';

@ApiTags('Game Sessions')
@ApiServiceUnavailableResponse({
  description: 'The durable Game Session authority is temporarily unavailable.',
})
@Controller('game-sessions')
export class GameSessionsController {
  private readonly guestCookies = createGuestCookieSigner(
    gameSessionsConfig.guestCookieName,
    guestCookieSecret(),
  );

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
  async createMafiaSession(
    @Body() body: CreateMafiaSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @OptionalIdempotencyKey() idempotencyKey: string | undefined,
  ) {
    return this.resolveGameSessionResult(
      (
        await this.gameSessionsService.createMafiaSession(
          this.holderId(request.headers.cookie),
          body.participantCount,
          idempotencyKey,
        )
      ).map(({ holderId, projection }) => {
        response.cookie(gameSessionsConfig.guestCookieName, this.guestCookies.sign(holderId), {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
        });
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
  async snapshot(@Param('sessionId') sessionId: string, @Req() request: Request) {
    return this.projectionFor(sessionId, this.holderId(request.headers.cookie));
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
  async submitPublicSpeech(
    @Param('sessionId') sessionId: string,
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitPublicSpeech(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitMafiaChat(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateMafiaChatDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitMafiaChat(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitNomination(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitNomination(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitFinalDefence(
    @Param('sessionId') sessionId: string,
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitFinalDefence(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitVerdict(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateVerdictDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitVerdict(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitMafiaTarget(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitMafiaTarget(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async submitDoctorProtection(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitDoctorProtection(
        sessionId,
        this.holderId(request.headers.cookie),
        body.targetParticipantId,
        idempotencyKey,
      ),
    );
  }

  @Post(':sessionId/actions/police-investigation')
  @ApiOperation({ summary: 'Submit the Human Player private Police investigation' })
  @ApiCookieAuth('withai_guest')
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  async submitPoliceInvestigation(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.submitPoliceInvestigation(
        sessionId,
        this.holderId(request.headers.cookie),
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
  async adjustDiscussionTime(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateDiscussionTimeAdjustmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    return this.resolveGameSessionResult(
      this.gameSessionsService.adjustDiscussionTime(
        sessionId,
        this.holderId(request.headers.cookie),
        body.adjustmentSeconds,
        body.expectedDeadline,
        idempotencyKey,
      ),
      response,
    );
  }

  @Get(':sessionId/events')
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
  async events(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    let subscription: Subscription | undefined;
    let closed = request.destroyed;
    const close = () => {
      closed = true;
      subscription?.unsubscribe();
    };
    request.once('close', close);
    const events = this.resolveGameSessionResult(
      await this.gameSessionsService.eventsFor(
        sessionId,
        this.holderId(request.headers.cookie),
        this.lastEventId(request.headers['last-event-id']),
      ),
    );
    if (closed || request.destroyed) {
      request.off('close', close);
      return;
    }
    response.set({
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    response.flushHeaders();

    let sentSnapshot = false;
    subscription = events.subscribe({
      next: (projection) => {
        const eventId = sentSnapshot ? `id: ${projection.eventId}\n` : '';
        sentSnapshot = true;
        response.write(`event: snapshot\n${eventId}data: ${JSON.stringify(projection)}\n\n`);
      },
      error: () => response.end(),
      complete: () => response.end(),
    });
  }

  private async projectionFor(sessionId: string, cookie: string | undefined) {
    return this.resolveGameSessionResult(
      await this.gameSessionsService.getProjection(sessionId, cookie),
    );
  }

  private resolveGameSessionResult<Value>(
    result: Result<Value, GameSessionError>,
    response?: Response,
  ): Value;
  private resolveGameSessionResult<Value>(
    result: Promise<Result<Value, GameSessionError>>,
    response?: Response,
  ): Promise<Value>;
  private resolveGameSessionResult<Value>(
    result: Result<Value, GameSessionError> | Promise<Result<Value, GameSessionError>>,
    response?: Response,
  ): Value | Promise<Value> {
    if (result instanceof Promise) {
      return result.then((value) => this.resolveGameSessionResult(value, response));
    }
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
        { type: 'durability-unavailable' },
        () =>
          new HttpException(
            'The Game Session authority is temporarily unavailable.',
            HttpStatus.SERVICE_UNAVAILABLE,
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

  private holderId(cookie: string | undefined) {
    return this.guestCookies.read(cookie);
  }
}
