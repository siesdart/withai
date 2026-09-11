import { randomInt, randomUUID } from 'node:crypto';

import type { MafiaAgentSpeechContext } from '@repo/mafia';
import type { MafiaGameProjection } from '@repo/mafia';
import dayjs from 'dayjs';
import { ok, type Result } from 'neverthrow';
import { filter, find, map, pipe, sortBy } from 'remeda';
import { match } from 'ts-pattern';

import { nativeGameSessionClock, type GameSessionClock } from '../application/game-session-clock';
import type { GameSessionError } from '../application/game-session-error';
import type {
  StoredGameSessionEntity,
  ScheduledAgentFinalDefence,
  ScheduledAgentMafiaChatReply,
  ScheduledAgentPublicSpeech,
} from '../application/stored-game-session.entity';
import {
  scheduledAgentPublicSpeechKey,
  sameScheduledAgentFinalDefence,
} from '../application/stored-game-session.entity';
import type { AgentDecisionGateway } from './agent-decision.gateway';

type PublishProjection = (
  session: StoredGameSessionEntity,
  hydrationLocked?: boolean,
) => Promise<Result<MafiaGameProjection, GameSessionError>>;

type CommitAgentMutation = (
  session: StoredGameSessionEntity,
  mutate: (session: StoredGameSessionEntity) => boolean,
  schedulePhaseTransition?: boolean,
  hydrationLocked?: boolean,
) => Promise<Result<void, GameSessionError>>;

type DueScheduledTask = {
  dueAt: string;
  commit(hydrationLocked: boolean): Promise<Result<void, GameSessionError>>;
};

export class GameSessionAgentOrchestrator {
  private readonly drainingSessionIds = new Set<string>();

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

  resumeScheduledTasks(session: StoredGameSessionEntity) {
    if (session.status !== 'in-progress') return;
    for (const speech of session.scheduledAgentPublicSpeeches) {
      if (!session.publicSpeechAgentTimers.has(scheduledAgentPublicSpeechKey(speech)))
        this.schedulePublicSpeechReply(session, speech.participantId, speech);
    }
    if (session.scheduledAgentFinalDefence && !session.agentFinalDefenceTimer) {
      const { participantId, content, dueAt } = session.scheduledAgentFinalDefence;
      this.scheduleFinalDefenceFollowUp(session, participantId, content, dueAt);
    }
    if (session.scheduledMafiaTargetFallbackAt && !session.mafiaTargetFallbackTimer)
      this.scheduleMafiaTargetFallback(session, session.scheduledMafiaTargetFallbackAt);
  }

  async drainDueScheduledTasks(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    if (session.status !== 'in-progress') return ok(undefined);
    const sessionId = session.gameSession.snapshot().sessionId;
    this.drainingSessionIds.add(sessionId);
    try {
      const dueTasks = sortBy(
        this.dueScheduledTasks(session, this.clock.now().valueOf()),
        (task) => task.dueAt,
      );
      const result = await this.consumeDueScheduledTasks(dueTasks, hydrationLocked);
      return result;
    } finally {
      this.drainingSessionIds.delete(sessionId);
    }
  }

  hasDueScheduledTasks(session: StoredGameSessionEntity) {
    return (
      session.status === 'in-progress' &&
      this.dueScheduledTasks(session, this.clock.now().valueOf()).length > 0
    );
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

  prepareMafiaChatReplies(session: StoredGameSessionEntity) {
    const dueAt = this.clock.now().toISOString();
    this.forEachMafiaAgent(session, (participantId, context) => {
      const targetParticipantId = this.mafiaTargetFor(session, context);
      const targetName =
        targetParticipantId && this.participantNameFor(context, targetParticipantId);
      if (!targetParticipantId || !targetName) return;
      session.scheduledAgentMafiaChatReplies.push({
        id: randomUUID(),
        participantId,
        content: this.agentDecisions.decideMafiaChatReply(context, targetName),
        dueAt,
      });
    });
  }

  publishMafiaChatReplies(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    return this.consumeMafiaChatReplies(
      session,
      session.scheduledAgentMafiaChatReplies,
      hydrationLocked,
    );
  }

  clearTimers(session: StoredGameSessionEntity) {
    if (session.agentFinalDefenceTimer) this.clock.clearTimeout(session.agentFinalDefenceTimer);
    if (session.mafiaTargetFallbackTimer) this.clock.clearTimeout(session.mafiaTargetFallbackTimer);
    for (const timer of session.publicSpeechAgentTimers.values()) this.clock.clearTimeout(timer);
    session.agentFinalDefenceTimer = undefined;
    session.publicSpeechAgentTimers.clear();
    session.mafiaTargetFallbackTimer = undefined;
    session.scheduledAgentPublicSpeeches = [];
    session.scheduledAgentFinalDefence = undefined;
    session.scheduledMafiaTargetFallbackAt = undefined;
  }

  private livingParticipantIds(projection: MafiaGameProjection) {
    return pipe(
      projection.public.participants,
      filter(({ alive }) => alive),
      map(({ id }) => id),
    );
  }

  private schedulePublicSpeechReply(
    session: StoredGameSessionEntity,
    participantId: string,
    scheduled = this.publicSpeechFor(session, participantId),
  ) {
    if (!scheduled) return;
    const scheduledKey = scheduledAgentPublicSpeechKey(scheduled);
    if (session.publicSpeechAgentTimers.has(scheduledKey)) return;
    if (
      !session.scheduledAgentPublicSpeeches.some((candidate) =>
        this.sameScheduledSpeech(candidate, scheduled),
      )
    )
      session.scheduledAgentPublicSpeeches.push(scheduled);
    const delayMs = Math.max(0, dayjs(scheduled.dueAt).diff(this.clock.now()));
    const timer = this.clock.setTimeout(() => {
      session.publicSpeechAgentTimers.delete(scheduledKey);
      if (this.isDraining(session)) return;
      void this.commitPublicSpeech(session, scheduled);
    }, delayMs);
    session.publicSpeechAgentTimers.set(scheduledKey, timer);
    timer.unref?.();
  }

  private publishMafiaNightOpenings(session: StoredGameSessionEntity) {
    this.submitMafiaAgentTarget(session);
    this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.agentDecisions.decideMafiaChatOpening(context, targetName),
    );
  }

  private scheduleMafiaTargetFallback(session: StoredGameSessionEntity, dueAt: string) {
    if (session.mafiaTargetFallbackTimer) this.clock.clearTimeout(session.mafiaTargetFallbackTimer);
    const fallbackAt =
      session.scheduledMafiaTargetFallbackAt ?? dayjs(dueAt).subtract(1, 'second').toISOString();
    session.scheduledMafiaTargetFallbackAt = fallbackAt;
    const delayMs = Math.max(0, dayjs(fallbackAt).diff(this.clock.now()));
    session.mafiaTargetFallbackTimer = this.clock.setTimeout(() => {
      session.mafiaTargetFallbackTimer = undefined;
      if (this.isDraining(session)) return;
      void this.commitMafiaTargetFallback(session, fallbackAt);
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

  private submitMafiaAgentTarget(session: StoredGameSessionEntity, now = this.clock.now()) {
    let coordinator: { participantId: string; context: MafiaAgentSpeechContext } | undefined;
    this.forEachMafiaAgent(session, (participantId, context) => {
      coordinator ??= { participantId, context };
    });
    if (!coordinator) return;
    const targetParticipantId = this.mafiaTargetFor(session, coordinator.context);
    if (targetParticipantId)
      session.gameSession.submitMafiaTarget(coordinator.participantId, targetParticipantId, now);
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
    dueAt: string,
  ) {
    if (session.agentFinalDefenceTimer) this.clock.clearTimeout(session.agentFinalDefenceTimer);
    const scheduled = session.scheduledAgentFinalDefence ?? {
      participantId,
      content,
      dueAt: dayjs(this.clock.now())
        .add(Math.max(0, Math.floor(dayjs(dueAt).diff(this.clock.now()) / 2)), 'millisecond')
        .toISOString(),
    };
    session.scheduledAgentFinalDefence = scheduled;
    const delayMs = Math.max(0, dayjs(scheduled.dueAt).diff(this.clock.now()));
    session.agentFinalDefenceTimer = this.clock.setTimeout(() => {
      session.agentFinalDefenceTimer = undefined;
      if (this.isDraining(session)) return;
      void this.commitFinalDefence(session, scheduled);
    }, delayMs);
    session.agentFinalDefenceTimer.unref?.();
  }

  private publicSpeechFor(session: StoredGameSessionEntity, participantId: string) {
    return session.gameSession.agentSpeechContextFor(participantId).match(
      (context) =>
        match(this.agentDecisions.decidePublicSpeech(context))
          .with({ type: 'speak' }, (decision) => ({
            participantId,
            content: decision.content,
            dueAt: dayjs(this.clock.now()).add(decision.delayMs, 'millisecond').toISOString(),
          }))
          .with({ type: 'remain-silent' }, () => undefined)
          .exhaustive(),
      () => undefined,
    );
  }

  private sameScheduledSpeech(left: ScheduledAgentPublicSpeech, right: ScheduledAgentPublicSpeech) {
    return scheduledAgentPublicSpeechKey(left) === scheduledAgentPublicSpeechKey(right);
  }

  private dueScheduledTasks(session: StoredGameSessionEntity, now: number): DueScheduledTask[] {
    const publicSpeeches = pipe(
      session.scheduledAgentPublicSpeeches,
      filter((speech) => dayjs(speech.dueAt).valueOf() <= now),
      map((speech): DueScheduledTask => ({
        dueAt: speech.dueAt,
        commit: (hydrationLocked) =>
          this.commitPublicSpeech(session, speech, false, hydrationLocked),
      })),
    );
    const finalDefence = session.scheduledAgentFinalDefence;
    const finalDefenceTask =
      finalDefence && dayjs(finalDefence.dueAt).valueOf() <= now
        ? [
            {
              dueAt: finalDefence.dueAt,
              commit: (hydrationLocked: boolean) =>
                this.commitFinalDefence(session, finalDefence, false, hydrationLocked),
            },
          ]
        : [];
    const fallbackAt = session.scheduledMafiaTargetFallbackAt;
    const fallbackTask =
      fallbackAt && dayjs(fallbackAt).valueOf() <= now
        ? [
            {
              dueAt: fallbackAt,
              commit: (hydrationLocked: boolean) =>
                this.commitMafiaTargetFallback(session, fallbackAt, false, hydrationLocked),
            },
          ]
        : [];
    const mafiaChatReplies = pipe(
      session.scheduledAgentMafiaChatReplies,
      filter((reply) => dayjs(reply.dueAt).valueOf() <= now),
      map((reply): DueScheduledTask => ({
        dueAt: reply.dueAt,
        commit: (hydrationLocked) => this.commitMafiaChatReply(session, reply, hydrationLocked),
      })),
    );
    return [...publicSpeeches, ...finalDefenceTask, ...fallbackTask, ...mafiaChatReplies];
  }

  private isDraining(session: StoredGameSessionEntity) {
    return this.drainingSessionIds.has(session.gameSession.snapshot().sessionId);
  }

  private async consumeDueScheduledTasks(
    dueTasks: DueScheduledTask[],
    hydrationLocked: boolean,
  ): Promise<Result<void, GameSessionError>> {
    const [task, ...remaining] = dueTasks;
    if (!task) return ok(undefined);
    const committed = await task.commit(hydrationLocked);
    if (committed.isErr()) return committed;
    return this.consumeDueScheduledTasks(remaining, hydrationLocked);
  }

  private async consumeMafiaChatReplies(
    session: StoredGameSessionEntity,
    replies: ScheduledAgentMafiaChatReply[],
    hydrationLocked: boolean,
  ): Promise<Result<void, GameSessionError>> {
    const [reply, ...remaining] = replies;
    if (!reply) return ok(undefined);
    const committed = await this.commitMafiaChatReply(session, reply, hydrationLocked);
    if (committed.isErr()) return committed;
    return this.consumeMafiaChatReplies(session, remaining, hydrationLocked);
  }

  private commitPublicSpeech(
    session: StoredGameSessionEntity,
    scheduled: ScheduledAgentPublicSpeech,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ) {
    const scheduledKey = scheduledAgentPublicSpeechKey(scheduled);
    return this.commitAgentMutation(
      session,
      (current) => {
        current.publicSpeechAgentTimers.delete(scheduledKey);
        if (
          !find(current.scheduledAgentPublicSpeeches, (candidate) =>
            this.sameScheduledSpeech(candidate, scheduled),
          )
        )
          return false;
        current.scheduledAgentPublicSpeeches = filter(
          current.scheduledAgentPublicSpeeches,
          (candidate) => !this.sameScheduledSpeech(candidate, scheduled),
        );
        return current.gameSession
          .submitPublicSpeech(
            scheduled.participantId,
            scheduled.content,
            dayjs(scheduled.dueAt).toDate(),
          )
          .isOk();
      },
      schedulePhaseTransition,
      hydrationLocked,
    );
  }

  private commitFinalDefence(
    session: StoredGameSessionEntity,
    scheduled: ScheduledAgentFinalDefence,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ) {
    return this.commitAgentMutation(
      session,
      (current) => {
        current.agentFinalDefenceTimer = undefined;
        if (
          !current.scheduledAgentFinalDefence ||
          !sameScheduledAgentFinalDefence(current.scheduledAgentFinalDefence, scheduled)
        )
          return false;
        current.scheduledAgentFinalDefence = undefined;
        return current.gameSession
          .submitFinalDefence(
            scheduled.participantId,
            scheduled.content,
            dayjs(scheduled.dueAt).toDate(),
          )
          .isOk();
      },
      schedulePhaseTransition,
      hydrationLocked,
    );
  }

  private commitMafiaChatReply(
    session: StoredGameSessionEntity,
    scheduled: ScheduledAgentMafiaChatReply,
    hydrationLocked = false,
  ) {
    return this.commitAgentMutation(
      session,
      (current) => {
        const pending = find(
          current.scheduledAgentMafiaChatReplies,
          (candidate) => candidate.id === scheduled.id,
        );
        if (!pending) return false;
        const submitted = current.gameSession.submitMafiaChat(
          pending.participantId,
          pending.content,
          dayjs(pending.dueAt).toDate(),
        );
        if (submitted.isErr()) return false;
        current.scheduledAgentMafiaChatReplies = filter(
          current.scheduledAgentMafiaChatReplies,
          (candidate) => candidate.id !== pending.id,
        );
        return true;
      },
      true,
      hydrationLocked,
    );
  }

  private commitMafiaTargetFallback(
    session: StoredGameSessionEntity,
    fallbackAt: string,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ) {
    return this.commitAgentMutation(
      session,
      (current) => {
        current.mafiaTargetFallbackTimer = undefined;
        if (current.scheduledMafiaTargetFallbackAt !== fallbackAt) return false;
        current.scheduledMafiaTargetFallbackAt = undefined;
        if (this.humanMafiaTarget(current)) return false;
        const before = JSON.stringify(current.gameSession.snapshot());
        this.submitMafiaAgentTarget(current, dayjs(fallbackAt).toDate());
        return before !== JSON.stringify(current.gameSession.snapshot());
      },
      schedulePhaseTransition,
      hydrationLocked,
    );
  }
}
