import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Result } from 'neverthrow';
import type { Subscription } from 'rxjs';
import { match } from 'ts-pattern';

import { retryAfterSeconds } from '../application/cooldown/cooldown.js';
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
import { GuestPlayAllowanceEntity } from './guest-play-allowance.entity.js';
import { createHolderTokenSigner, holderTokenHeader, holderTokenSecret } from './holder-token.js';
import { OptionalIdempotencyKey, RequiredIdempotencyKey } from './idempotency-key.decorator.js';
import { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity.js';

@ApiTags('Game Sessions')
@ApiServiceUnavailableResponse({
  description: 'The durable Game Session authority is temporarily unavailable.',
})
@ApiUnauthorizedResponse({
  description: 'The X-Holder-Token header is missing or invalid.',
})
@Controller('game-sessions')
export class GameSessionsController {
  private readonly holderTokens = createHolderTokenSigner(holderTokenSecret());

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
    description:
      'The initial authorized projection. The signed holder token is returned in X-Holder-Token.',
    type: MafiaGameSessionProjectionEntity,
  })
  @ApiHeader({ name: holderTokenHeader, required: false })
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
          this.holderId(request),
          body.participantCount,
          idempotencyKey,
          body.humanName,
          body.outputLanguage,
          false,
          this.allowanceHolderId(request),
        )
      ).map(({ holderId, projection }) => {
        this.setHolderToken(response, holderId);
        return projection;
      }),
    );
  }

  @Get('mafia/allowance')
  @ApiOperation({ summary: 'Get the anonymous guest remaining daily Game Session allowance' })
  @ApiHeader({ name: holderTokenHeader, required: false })
  @ApiOkResponse({ type: GuestPlayAllowanceEntity })
  async guestPlayAllowance(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.resolveGameSessionResult(
      (
        await this.gameSessionsService.guestPlayAllowance(
          this.allowanceHolderId(request),
          this.holderId(request, true),
        )
      ).map(({ holderId, ...allowance }) => {
        this.setHolderToken(response, holderId);
        return allowance;
      }),
      response,
    );
  }

  @Get('mafia/active')
  @ApiOperation({ summary: 'Get the anonymous guest active Mafia Game Session, if any' })
  @ApiHeader({ name: holderTokenHeader, required: false })
  @ApiOkResponse({ description: 'The active Game Session or null when none is available.' })
  async activeMafiaSession(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const holderId = this.requireHolderId(this.holderId(request, true));
    this.setHolderToken(response, holderId);
    return this.resolveGameSessionResult(
      (await this.gameSessionsService.activeMafiaSession(holderId)).map(
        (session) => session ?? null,
      ),
    );
  }

  @Get('mafia/snapshot')
  @ApiOperation({ summary: 'Get the current authorized Game Session snapshot' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiOkResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  async snapshot(@Req() request: Request) {
    return this.resolveGameSessionResult(this.currentProjection(this.holderId(request)));
  }

  @Post('mafia/actions/public-speech')
  @ApiOperation({ summary: 'Submit Public Chat speech for the Human Player' })
  @ApiHeader({ name: holderTokenHeader, required: true })
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
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitPublicSpeech(
          sessionId,
          holderId,
          body.content,
          idempotencyKey,
        ),
      ),
      response,
    );
  }

  @Post('mafia/actions/mafia-chat')
  @ApiOperation({ summary: 'Submit a private Mafia Chat statement during Night' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateMafiaChatDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  async submitMafiaChat(
    @Body() body: CreateMafiaChatDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitMafiaChat(sessionId, holderId, body.content, idempotencyKey),
      ),
      response,
    );
  }

  @Post('mafia/actions/nomination')
  @ApiOperation({ summary: 'Nominate a living Participant for Final Defence' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The nomination is not permitted in the current Phase.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  async submitNomination(
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitNomination(
          sessionId,
          holderId,
          body.targetParticipantId,
          idempotencyKey,
        ),
      ),
    );
  }

  @Post('mafia/actions/final-defence')
  @ApiOperation({ summary: 'Submit the nominated Human Player Final Defence' })
  @ApiHeader({ name: holderTokenHeader, required: true })
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
    @Body() body: CreatePublicSpeechDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitFinalDefence(
          sessionId,
          holderId,
          body.content,
          idempotencyKey,
        ),
      ),
      response,
    );
  }

  @Post('mafia/actions/verdict')
  @ApiOperation({ summary: 'Submit the Human Player verdict vote' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateVerdictDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiBadRequestResponse({ description: 'The verdict is not permitted in the current Phase.' })
  @ApiConflictResponse({ description: 'The idempotency key was reused with a different action.' })
  async submitVerdict(
    @Body() body: CreateVerdictDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitVerdict(sessionId, holderId, body.vote, idempotencyKey),
      ),
    );
  }

  @Post('mafia/actions/mafia-target')
  @ApiOperation({ summary: 'Submit the Human Player private Mafia target' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  async submitMafiaTarget(
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitMafiaTarget(
          sessionId,
          holderId,
          body.targetParticipantId,
          idempotencyKey,
        ),
      ),
    );
  }

  @Post('mafia/actions/doctor-protection')
  @ApiOperation({ summary: 'Submit the Human Player private Doctor protection' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  async submitDoctorProtection(
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitDoctorProtection(
          sessionId,
          holderId,
          body.targetParticipantId,
          idempotencyKey,
        ),
      ),
    );
  }

  @Post('mafia/actions/police-investigation')
  @ApiOperation({ summary: 'Submit the Human Player private Police investigation' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiBody({ type: CreateNominationDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: MafiaGameSessionProjectionEntity })
  async submitPoliceInvestigation(
    @Body() body: CreateNominationDto,
    @Req() request: Request,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.submitPoliceInvestigation(
          sessionId,
          holderId,
          body.targetParticipantId,
          idempotencyKey,
        ),
      ),
    );
  }

  @Post('mafia/actions/discussion-time-adjustment')
  @ApiOperation({ summary: 'Adjust the Discussion deadline for the Human Player' })
  @ApiHeader({ name: holderTokenHeader, required: true })
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
    @Body() body: CreateDiscussionTimeAdjustmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @RequiredIdempotencyKey() idempotencyKey: string,
  ) {
    const holderId = this.requiredHolderId(request);
    return this.resolveGameSessionResult(
      this.withCurrentSession(holderId, (sessionId) =>
        this.gameSessionsService.adjustDiscussionTime(
          sessionId,
          holderId,
          body.adjustmentSeconds,
          body.expectedDeadline,
          idempotencyKey,
        ),
      ),
      response,
    );
  }

  @Get('mafia/events')
  @ApiOperation({ summary: 'Subscribe to ordered Game Session SSE events' })
  @ApiHeader({ name: holderTokenHeader, required: true })
  @ApiResponse({
    status: 200,
    description:
      'A text/event-stream of authorized snapshots. Event IDs are monotonically increasing.',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiForbiddenResponse({
    description: 'The Game Session does not exist or is unavailable to this guest.',
  })
  async events(@Req() request: Request, @Res() response: Response): Promise<void> {
    const holderId = this.requiredHolderId(request);
    let subscription: Subscription | undefined;
    let closed = request.destroyed;
    const close = () => {
      closed = true;
      subscription?.unsubscribe();
    };
    request.once('close', close);
    const currentSession = await this.latestSessionId(holderId);
    const events = this.resolveGameSessionResult(
      await this.gameSessionsService.eventsFor(
        currentSession,
        holderId,
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

  private async currentProjection(holderId: string | undefined) {
    const requiredHolderId = this.requireHolderId(holderId);
    const sessionId = await this.latestSessionId(requiredHolderId);
    return this.gameSessionsService.getProjection(sessionId, requiredHolderId);
  }

  private async withCurrentSession<Value>(
    holderId: string,
    operation: (
      sessionId: string,
    ) => Result<Value, GameSessionError> | Promise<Result<Value, GameSessionError>>,
  ) {
    return operation(await this.currentSessionId(holderId));
  }

  private async currentSessionId(holderId: string): Promise<string> {
    const activeSessionId = await this.gameSessionsService.activeSessionIdForHolder(holderId);
    if (activeSessionId.isErr()) {
      throw this.toHttpException(activeSessionId.error);
    }
    if (!activeSessionId.value)
      throw new ForbiddenException('This Game Session is not available to this guest.');
    return activeSessionId.value;
  }

  private async latestSessionId(holderId: string): Promise<string> {
    const latestSessionId = await this.gameSessionsService.latestSessionIdForHolder(holderId);
    if (latestSessionId.isErr()) {
      throw this.toHttpException(latestSessionId.error);
    }
    if (!latestSessionId.value)
      throw new ForbiddenException('This Game Session is not available to this guest.');
    return latestSessionId.value;
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
        { type: 'speech-rate-limited' },
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
        { type: 'mafia-chat-idempotency-conflict' },
        { type: 'day-action-idempotency-conflict' },
        { type: 'discussion-time-adjustment-idempotency-conflict' },
        () =>
          new HttpException(
            'The Idempotency-Key was already used with a different action.',
            HttpStatus.CONFLICT,
          ),
      )
      .with(
        { type: 'speech-rate-limited' },
        () =>
          new HttpException(
            'Please wait before submitting another message.',
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
        { type: 'day-action-rate-limited' },
        () =>
          new HttpException(
            'Please wait before submitting another Final Defence statement.',
            HttpStatus.TOO_MANY_REQUESTS,
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

  private holderId(request: Request, mint = false) {
    const header = request.headers[holderTokenHeader.toLowerCase()];
    const token = typeof header === 'string' ? header : undefined;
    if (!token) {
      return mint ? this.holderTokens.createHolderId() : undefined;
    }

    const holderId = this.holderTokens.read(token);
    if (!holderId) {
      throw new UnauthorizedException({
        code: 'invalid-holder-token',
        message: 'The holder token is missing or invalid.',
      });
    }
    return holderId;
  }

  private requiredHolderId(request: Request) {
    return this.requireHolderId(this.holderId(request));
  }

  private requireHolderId(holderId: string | undefined) {
    if (holderId) return holderId;
    throw new UnauthorizedException({
      code: 'invalid-holder-token',
      message: 'The holder token is missing or invalid.',
    });
  }

  private setHolderToken(response: Response, holderId: string) {
    response.setHeader(holderTokenHeader, this.holderTokens.sign(holderId));
  }

  private allowanceHolderId(request: Request) {
    return `ip:${request.ip}`;
  }
}
