import { randomInt } from 'node:crypto';

import type { MafiaAgentSpeechContext } from '@repo/mafia';
import dayjs from 'dayjs';
import type { Result } from 'neverthrow';
import { filter, find, map, pipe } from 'remeda';
import { match, P } from 'ts-pattern';

import type { AgentDecisionGateway } from './agent-decision.gateway';
import type { MafiaGameSessionProjectionEntity } from './entities/mafia-game-session-projection.entity';
import type { StoredGameSessionEntity } from './entities/stored-game-session.entity';
import { nativeGameSessionClock, type GameSessionClock } from './game-session-clock';
import type { GameSessionError } from './game-session-error';

type PublishProjection = (
  session: StoredGameSessionEntity,
) => Promise<Result<MafiaGameSessionProjectionEntity, GameSessionError>>;

type CommitAgentMutation = (
  session: StoredGameSessionEntity,
  mutate: (session: StoredGameSessionEntity) => boolean,
) => Promise<void>;

export class GameSessionAgentOrchestrator {
  constructor(
    private readonly agentDecisions: AgentDecisionGateway,
    private readonly publishProjection: PublishProjection,
    private readonly commitAgentMutation: CommitAgentMutation,
    private readonly clock: GameSessionClock = nativeGameSessionClock,
  ) {}

  publishPublicSpeechReplies(session: StoredGameSessionEntity) {
    for (const participantId of session.gameSession.livingAgentParticipantIds(
      session.humanParticipantId,
    )) {
      this.schedulePublicSpeechReply(session, participantId);
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

  async publishMafiaChatReplies(session: StoredGameSessionEntity) {
    this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.agentDecisions.decideMafiaChatReply(context, targetName),
    );
    await this.publishProjection(session);
  }

  clearTimers(session: StoredGameSessionEntity) {
    if (session.agentFinalDefenceTimer) this.clock.clearTimeout(session.agentFinalDefenceTimer);
    if (session.mafiaTargetFallbackTimer) this.clock.clearTimeout(session.mafiaTargetFallbackTimer);
    for (const timer of session.publicSpeechAgentTimers) this.clock.clearTimeout(timer);
    session.publicSpeechAgentTimers.clear();
  }

  private livingParticipantIds(projection: MafiaGameSessionProjectionEntity) {
    return pipe(
      projection.public.participants,
      filter(({ alive }) => alive),
      map(({ id }) => id),
    );
  }

  private schedulePublicSpeechReply(session: StoredGameSessionEntity, participantId: string) {
    const delayMs = Number.parseInt(participantId.split('-')[1] ?? '1', 10) * 100;
    const timer = this.clock.setTimeout(() => {
      session.publicSpeechAgentTimers.delete(timer);
      void this.commitAgentMutation(session, (current) =>
        current.gameSession.agentSpeechContextFor(participantId).match(
          (context) =>
            match(this.agentDecisions.decidePublicSpeech(context))
              .with({ type: 'speak', content: P.select() }, (content) =>
                current.gameSession
                  .submitPublicSpeech(participantId, content, this.clock.now())
                  .isOk(),
              )
              .with({ type: 'remain-silent' }, () => false)
              .exhaustive(),
          () => false,
        ),
      );
    }, delayMs);
    session.publicSpeechAgentTimers.add(timer);
    timer.unref?.();
  }

  private publishMafiaNightOpenings(session: StoredGameSessionEntity) {
    this.submitMafiaAgentTarget(session);
    this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.agentDecisions.decideMafiaChatOpening(context, targetName),
    );
  }

  private scheduleMafiaTargetFallback(session: StoredGameSessionEntity, phaseDeadline: string) {
    if (session.mafiaTargetFallbackTimer) this.clock.clearTimeout(session.mafiaTargetFallbackTimer);
    const delayMs = Math.max(0, dayjs(phaseDeadline).diff(this.clock.now()) - 1_000);
    session.mafiaTargetFallbackTimer = this.clock.setTimeout(() => {
      void this.commitAgentMutation(session, (current) => {
        if (this.humanMafiaTarget(current)) return false;
        const before = JSON.stringify(current.gameSession.snapshot());
        this.submitMafiaAgentTarget(current);
        return before !== JSON.stringify(current.gameSession.snapshot());
      });
    }, delayMs);
    session.mafiaTargetFallbackTimer.unref?.();
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
    if (session.agentFinalDefenceTimer) this.clock.clearTimeout(session.agentFinalDefenceTimer);
    const delayMs = Math.max(0, Math.floor(dayjs(phaseDeadline).diff(this.clock.now()) / 2));
    session.agentFinalDefenceTimer = this.clock.setTimeout(() => {
      void this.commitAgentMutation(session, (current) =>
        current.gameSession.submitFinalDefence(participantId, content, this.clock.now()).isOk(),
      );
    }, delayMs);
    session.agentFinalDefenceTimer.unref?.();
  }
}
