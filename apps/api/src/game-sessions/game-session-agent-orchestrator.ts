import { randomInt } from 'node:crypto';

import type { MafiaAgentSpeechContext } from '@repo/mafia';
import type { Result } from 'neverthrow';
import { filter, find, map, pipe } from 'remeda';
import { match, P } from 'ts-pattern';

import type { AgentDecisionGateway } from './agent-decision.gateway';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import type { GameSessionError } from './game-session-error';

type PublishProjection = (
  session: StoredGameSessionEntity,
) => Result<MafiaGameSessionProjectionEntity, GameSessionError>;

export class GameSessionAgentOrchestrator {
  constructor(
    private readonly agentDecisions: AgentDecisionGateway,
    private readonly publishProjection: PublishProjection,
  ) {}

  publishPublicSpeechReplies(session: StoredGameSessionEntity) {
    for (const participantId of session.gameSession.livingAgentParticipantIds(
      session.humanParticipantId,
    )) {
      session.gameSession.agentSpeechContextFor(participantId).match(
        (context) => {
          const decision = this.agentDecisions.decidePublicSpeech(context);
          return match(decision)
            .with({ type: 'remain-silent' }, () => undefined)
            .with(
              { type: 'speak', content: P.select('content'), delayMs: P.select('delayMs') },
              ({ content, delayMs }) =>
                this.schedulePublicSpeechReply(session, participantId, content, delayMs),
            )
            .exhaustive();
        },
        () => undefined,
      );
    }
  }

  submitDayActions(session: StoredGameSessionEntity) {
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr()) return;

    const agentIds = session.gameSession.livingAgentParticipantIds(session.humanParticipantId);
    if (projection.value.public.phase === 'nomination') {
      const livingParticipantIds = this.livingParticipantIds(projection.value);
      if (livingParticipantIds.length === 0) return;
      for (const participantId of agentIds) {
        const targetParticipantId = livingParticipantIds[randomInt(livingParticipantIds.length)];
        if (targetParticipantId)
          session.gameSession.submitNomination(participantId, targetParticipantId);
      }
    }
    if (projection.value.public.phase === 'verdict') {
      for (const participantId of agentIds) {
        session.gameSession.submitVerdict(
          participantId,
          randomInt(2) === 0 ? 'eliminate' : 'spare',
        );
      }
    }
    if (projection.value.public.phase === 'night') {
      const livingParticipantIds = this.livingParticipantIds(projection.value);
      for (const participantId of agentIds) {
        const targetParticipantIds = filter(
          livingParticipantIds,
          (targetParticipantId) => targetParticipantId !== participantId,
        );
        const targetParticipantId = targetParticipantIds[randomInt(targetParticipantIds.length)];
        if (!targetParticipantId) continue;
        session.gameSession.submitDoctorProtection(participantId, targetParticipantId);
        session.gameSession.submitDetectiveInvestigation(participantId, targetParticipantId);
      }
      this.publishMafiaNightOpenings(session);
      this.scheduleMafiaTargetFallback(session, projection.value.public.phaseDeadline);
    }
    if (projection.value.public.phase === 'final-defence') {
      const nominatedParticipantId = projection.value.public.nominatedParticipantId;
      if (!nominatedParticipantId || nominatedParticipantId === session.humanParticipantId) return;
      session.gameSession.agentSpeechContextFor(nominatedParticipantId).match(
        (context) => {
          const decision = this.agentDecisions.decideFinalDefence(context);
          session.gameSession.submitFinalDefence(nominatedParticipantId, decision.opening).match(
            () =>
              this.scheduleFinalDefenceFollowUp(
                session,
                nominatedParticipantId,
                decision.followUp,
                projection.value.public.phaseDeadline,
              ),
            () => undefined,
          );
        },
        () => undefined,
      );
    }
  }

  publishMafiaChatReplies(session: StoredGameSessionEntity) {
    this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.agentDecisions.decideMafiaChatReply(context, targetName),
    );
    this.publishProjection(session).match(
      () => undefined,
      () => undefined,
    );
  }

  clearTimers(session: StoredGameSessionEntity) {
    if (session.agentFinalDefenceTimer) clearTimeout(session.agentFinalDefenceTimer);
    if (session.mafiaTargetFallbackTimer) clearTimeout(session.mafiaTargetFallbackTimer);
  }

  private livingParticipantIds(projection: MafiaGameSessionProjectionEntity) {
    return pipe(
      projection.public.participants,
      filter(({ alive }) => alive),
      map(({ id }) => id),
    );
  }

  private schedulePublicSpeechReply(
    session: StoredGameSessionEntity,
    participantId: string,
    content: string,
    delayMs: number,
  ) {
    const timer = setTimeout(() => {
      session.gameSession.submitPublicSpeech(participantId, content).match(
        () =>
          this.publishProjection(session).match(
            () => undefined,
            () => undefined,
          ),
        () => undefined,
      );
    }, delayMs);
    timer.unref();
  }

  private publishMafiaNightOpenings(session: StoredGameSessionEntity) {
    this.submitMafiaAgentTarget(session);
    this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.agentDecisions.decideMafiaChatOpening(context, targetName),
    );
  }

  private scheduleMafiaTargetFallback(session: StoredGameSessionEntity, phaseDeadline: string) {
    if (session.mafiaTargetFallbackTimer) clearTimeout(session.mafiaTargetFallbackTimer);
    const delayMs = Math.max(0, Date.parse(phaseDeadline) - Date.now() - 1_000);
    session.mafiaTargetFallbackTimer = setTimeout(() => {
      if (this.humanMafiaTarget(session)) return;
      this.submitMafiaAgentTarget(session);
      this.publishProjection(session).match(
        () => undefined,
        () => undefined,
      );
    }, delayMs);
    session.mafiaTargetFallbackTimer.unref();
  }

  private publishMafiaAgentMessages(
    session: StoredGameSessionEntity,
    messageFor: (context: MafiaAgentSpeechContext, targetName: string) => string,
  ) {
    this.forEachMafiaAgent(session, (participantId, context) => {
      const targetParticipantId = this.mafiaTargetFor(session, context);
      const targetName =
        targetParticipantId && this.participantNameFor(context, targetParticipantId);
      if (!targetParticipantId || !targetName) return;
      session.gameSession.submitMafiaChat(participantId, messageFor(context, targetName));
    });
  }

  private submitMafiaAgentTarget(session: StoredGameSessionEntity) {
    let coordinator: { participantId: string; context: MafiaAgentSpeechContext } | undefined;
    this.forEachMafiaAgent(session, (participantId, context) => {
      coordinator ??= { participantId, context };
    });
    if (!coordinator) return;
    const targetParticipantId = this.mafiaTargetFor(session, coordinator.context);
    if (targetParticipantId)
      session.gameSession.submitMafiaTarget(coordinator.participantId, targetParticipantId);
  }

  private forEachMafiaAgent(
    session: StoredGameSessionEntity,
    action: (participantId: string, context: MafiaAgentSpeechContext) => void,
  ) {
    for (const participantId of session.gameSession.livingMafiaAgentParticipantIds(
      session.humanParticipantId,
    )) {
      session.gameSession.agentSpeechContextFor(participantId).match(
        (context) => action(participantId, context),
        () => undefined,
      );
    }
  }

  private mafiaTargetFor(session: StoredGameSessionEntity, context: MafiaAgentSpeechContext) {
    return (
      this.humanMafiaTarget(session) ??
      (context.personal.nightAction?.type === 'mafia-target'
        ? context.personal.nightAction.targetParticipantId
        : undefined) ??
      this.agentDecisions.selectMafiaTarget(context)
    );
  }

  private participantNameFor(context: MafiaAgentSpeechContext, participantId: string) {
    return find(context.public.participants, ({ id }) => id === participantId)?.name;
  }

  private humanMafiaTarget(session: StoredGameSessionEntity) {
    return session.gameSession.projectionFor(session.humanParticipantId, session.nextEventId).match(
      (projection) =>
        projection.personal.nightAction?.type === 'mafia-target'
          ? projection.personal.nightAction.targetParticipantId
          : undefined,
      () => undefined,
    );
  }

  private scheduleFinalDefenceFollowUp(
    session: StoredGameSessionEntity,
    participantId: string,
    content: string,
    phaseDeadline: string,
  ) {
    if (session.agentFinalDefenceTimer) clearTimeout(session.agentFinalDefenceTimer);
    const delayMs = Math.max(0, Math.floor((Date.parse(phaseDeadline) - Date.now()) / 2));
    session.agentFinalDefenceTimer = setTimeout(() => {
      session.gameSession.submitFinalDefence(participantId, content).match(
        () =>
          this.publishProjection(session).match(
            () => undefined,
            () => undefined,
          ),
        () => undefined,
      );
    }, delayMs);
    session.agentFinalDefenceTimer.unref();
  }
}
