import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Req,
  Res,
  Sse,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
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

import { CreateMafiaSessionDto } from './dto/create-mafia-session.dto';
import { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import { GameSessionsService } from './game-sessions.service';

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
  @ApiCreatedResponse({
    description: 'The initial authorized projection and a signed anonymous guest cookie.',
    type: MafiaGameSessionProjectionEntity,
  })
  @ApiTooManyRequestsResponse({ description: 'The Guest Play Allowance is exhausted for today.' })
  createMafiaSession(
    @Body() body: CreateMafiaSessionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (idempotencyKey && (idempotencyKey.length < 16 || idempotencyKey.length > 200)) {
      throw new BadRequestException('The Idempotency-Key header is invalid.');
    }
    const { holderId, projection } = this.gameSessionsService.createMafiaSession(
      request.headers.cookie,
      body.participantCount,
      idempotencyKey,
    );
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
  }

  @Get(':sessionId/snapshot')
  @ApiOperation({ summary: 'Get the current authorized Game Session snapshot' })
  @ApiCookieAuth('withai_guest')
  @ApiOkResponse({ type: MafiaGameSessionProjectionEntity })
  @ApiForbiddenResponse({ description: 'The Game Session is unavailable to this guest.' })
  snapshot(@Param('sessionId') sessionId: string, @Req() request: Request) {
    return this.projectionFor(sessionId, request.headers.cookie);
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
  @ApiForbiddenResponse({ description: 'The Game Session is unavailable to this guest.' })
  events(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Observable<{ id: string; type: string; data: object }> {
    try {
      return this.gameSessionsService
        .eventsFor(
          sessionId,
          request.headers.cookie,
          this.lastEventId(request.headers['last-event-id']),
        )
        .pipe(
          map((projection) => ({
            id: String(projection.eventId),
            type: 'snapshot',
            data: projection,
          })),
        );
    } catch {
      throw new ForbiddenException('This Game Session is not available to this guest.');
    }
  }

  private projectionFor(sessionId: string, cookie: string | undefined) {
    try {
      return this.gameSessionsService.getProjection(sessionId, cookie);
    } catch {
      throw new ForbiddenException('This Game Session is not available to this guest.');
    }
  }

  private lastEventId(value: string | string[] | undefined) {
    if (typeof value !== 'string') {
      return undefined;
    }

    const eventId = Number.parseInt(value, 10);
    return Number.isSafeInteger(eventId) && eventId >= 0 ? eventId : undefined;
  }
}
