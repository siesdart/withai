import { randomUUID } from 'node:crypto';

import type { MafiaAgentContext } from '@repo/mafia';
import type { MafiaGameProjection } from '@repo/mafia';
import dayjs from 'dayjs';
import { ok, type Result } from 'neverthrow';
import { filter, find, findLast, map, pipe, sortBy } from 'remeda';
import { match } from 'ts-pattern';

import {
  nativeGameSessionClock,
  type GameSessionClock,
} from '../application/game-session-clock.js';
import type { GameSessionError } from '../application/game-session-error.js';
import { gameSessionsConfig } from '../application/game-sessions.config.js';
import type {
  StoredGameSessionEntity,
  ScheduledAgentFinalDefence,
  ScheduledAgentMafiaChatReply,
  ScheduledAgentPublicSpeech,
} from '../application/stored-game-session.entity.js';
import {
  mafiaNightPhaseKey,
  scheduledAgentPublicSpeechKey,
  sameScheduledAgentFinalDefence,
} from '../application/stored-game-session.entity.js';
import { agentChatDueAt } from './agent-chat-timing.js';
import type { AgentDecisionGateway } from './agent-decision.gateway.js';
import {
  agentMindFor,
  hasHandledSnapshot,
  rememberAllegianceEstimates,
  rememberSnapshot,
  withAgentMind,
} from './agent-mind.js';

type CommitAgentMutation = (
  session: StoredGameSessionEntity,
  mutate: (session: StoredGameSessionEntity) => boolean,
  schedulePhaseTransition?: boolean,
  hydrationLocked?: boolean,
) => Promise<Result<void, GameSessionError>>;

type CurrentSessionFor = (session: StoredGameSessionEntity) => StoredGameSessionEntity | undefined;

type DueScheduledTask = {
  dueAt: string;
  commit(hydrationLocked: boolean): Promise<Result<void, GameSessionError>>;
};

type PublicSpeechRequest = {
  abortController: AbortController;
  snapshotKey: string;
};

type NightActionRequest = {
  phaseKey: string;
  promise: Promise<void>;
};

type VerdictRequest = {
  phaseKey: string;
  promise: Promise<void>;
};

type MafiaAgentTargetSelection = {
  participantId: string;
  targetParticipantId: string;
};

export class GameSessionAgentOrchestrator {
  private readonly drainingSessionIds = new Set<string>();
  private readonly publicSpeechRequests = new Map<string, PublicSpeechRequest>();
  private readonly nightActionRequests = new Map<string, NightActionRequest>();
  private readonly verdictRequests = new Map<string, VerdictRequest>();

  constructor(
    private readonly agentDecisions: AgentDecisionGateway,
    private readonly commitAgentMutation: CommitAgentMutation,
    private readonly clock: GameSessionClock = nativeGameSessionClock,
    private readonly currentSessionFor: CurrentSessionFor = (session) => session,
  ) {}

  async publishPublicSpeechReplies(session: StoredGameSessionEntity, hydrationLocked = false) {
    const snapshot = session.gameSession.snapshot();
    if (snapshot.phase !== 'discussion') return;
    if (
      session.autonomousPublicSpeechTurns >=
      gameSessionsConfig.maximumAutonomousPublicSpeechTurnsPerDiscussion
    ) {
      await this.recordAutonomousPublicSpeechLimitReached(session, snapshot, hydrationLocked);
      return;
    }

    const snapshotKey = this.publicSpeechSnapshotKey(snapshot);
    if (session.lastAutonomousPublicSpeechSnapshotKey === snapshotKey) return;
    if (this.hasPublicSpeechRequest(session, snapshotKey)) return;
    const request = this.beginPublicSpeechRequest(session, snapshotKey);

    try {
      for (const participantId of this.publicSpeechCandidateOrder(session)) {
        // oxlint-disable-next-line no-await-in-loop -- call one Agent at a time until one chooses to speak.
        const reply = await this.publicSpeechFor(session, participantId, request);
        if (!this.isCurrentPublicSpeechRequest(session, request)) return;
        if (reply) {
          session.lastAutonomousPublicSpeechSnapshotKey = snapshotKey;
          // oxlint-disable-next-line no-await-in-loop -- the selected Agent must be durably scheduled before this turn ends.
          await this.schedulePublicSpeechReply(session, reply);
          return;
        }
      }

      if (this.isCurrentPublicSpeechRequest(session, request))
        session.lastAutonomousPublicSpeechSnapshotKey = snapshotKey;
    } finally {
      this.releasePublicSpeechRequest(session, request);
    }
  }

  cancelPublicSpeechReply(session: StoredGameSessionEntity) {
    const sessionId = session.gameSession.snapshot().sessionId;
    const request = this.publicSpeechRequests.get(sessionId);
    if (!request) return;
    request.abortController.abort();
    this.publicSpeechRequests.delete(sessionId);
  }

  resumeScheduledTasks(session: StoredGameSessionEntity) {
    if (session.status !== 'in-progress') return;
    for (const speech of session.scheduledAgentPublicSpeeches) {
      if (!session.publicSpeechAgentTimers.has(scheduledAgentPublicSpeechKey(speech)))
        void this.schedulePublicSpeechReply(session, speech);
    }
    for (const reply of session.scheduledAgentMafiaChatReplies) {
      if (!session.mafiaChatReplyTimers.has(reply.id)) this.scheduleMafiaChatReply(session, reply);
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

  async submitDayActions(session: StoredGameSessionEntity) {
    const projection = session.gameSession.projectionFor(
      session.humanParticipantId,
      session.nextEventId,
    );
    if (projection.isErr()) return;

    const agentIds = session.gameSession.livingAgentParticipantIds(session.humanParticipantId);
    if (projection.value.public.phase === 'nomination') {
      const livingParticipantIds = this.livingParticipantIds(projection.value);
      if (livingParticipantIds.length === 0) return;
      const submittedAt = this.agentVoteSubmittedAt(projection.value);
      const nominations = filter(
        await Promise.all(
          map(agentIds, async (participantId) =>
            this.agentContextFor(session, participantId).match(
              async (context): Promise<MafiaAgentTargetSelection | undefined> => {
                const decision = await this.phaseActionFor(session, context, livingParticipantIds);
                rememberAllegianceEstimates(
                  agentMindFor(session.agentMinds, participantId),
                  context,
                  decision.allegianceEstimates,
                  decision.strategy,
                );
                if (!decision.targetParticipantId) return undefined;
                return { participantId, targetParticipantId: decision.targetParticipantId };
              },
              () => undefined,
            ),
          ),
        ),
        (nomination): nomination is MafiaAgentTargetSelection => nomination !== undefined,
      );
      if (nominations.length === 0) return;
      const current = this.currentSessionFor(session);
      if (!current) return;
      const currentProjection = current.gameSession.projectionFor(
        current.humanParticipantId,
        current.nextEventId,
      );
      if (currentProjection.isErr() || currentProjection.value.public.phase !== 'nomination')
        return;
      for (const nomination of nominations)
        current.gameSession.submitNomination(
          nomination.participantId,
          nomination.targetParticipantId,
          submittedAt,
        );
    }
    if (projection.value.public.phase === 'verdict') {
      await this.submitVerdictActions(session, projection.value, agentIds);
    }
    if (projection.value.public.phase === 'night') {
      await this.submitNightActions(session, projection.value);
    }
    if (projection.value.public.phase === 'final-defence') {
      const nominatedParticipantId = projection.value.public.nominatedParticipantId;
      if (!nominatedParticipantId || nominatedParticipantId === session.humanParticipantId) return;
      await this.agentContextFor(session, nominatedParticipantId).match(
        async (context) => {
          const decision = await this.decisionsFor(session).decideFinalDefence(context);
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

  async prepareMafiaChatReplies(session: StoredGameSessionEntity) {
    session.scheduledAgentMafiaChatReplies.push(...(await this.mafiaChatRepliesFor(session)));
  }

  async mafiaChatRepliesFor(session: StoredGameSessionEntity) {
    const phaseKey = mafiaNightPhaseKey(session.gameSession.snapshot());
    if (!phaseKey) return [];
    let earliestAt = this.clock.now();
    const replies: ScheduledAgentMafiaChatReply[] = [];
    await this.forEachMafiaAgent(session, async (participantId, context) => {
      const targetParticipantId = await this.mafiaTargetFor(session, context);
      const targetName =
        targetParticipantId && this.participantNameFor(context, targetParticipantId);
      if (!targetParticipantId || !targetName) return;
      const content = await this.decisionsFor(session).decideMafiaChatReply(context, targetName);
      if (mafiaNightPhaseKey(session.gameSession.snapshot()) !== phaseKey) return;
      const dueAt = agentChatDueAt({ content, earliestAt });
      replies.push({
        id: randomUUID(),
        participantId,
        content,
        dueAt,
        phaseKey,
      });
      earliestAt = dayjs(dueAt)
        .add(gameSessionsConfig.agentChatMinimumGapMs, 'millisecond')
        .toDate();
    });
    if (mafiaNightPhaseKey(session.gameSession.snapshot()) !== phaseKey) return [];
    return replies;
  }

  publishMafiaChatReplies(
    session: StoredGameSessionEntity,
    hydrationLocked = false,
  ): Promise<Result<void, GameSessionError>> {
    return this.consumeMafiaChatReplies(
      session,
      filter(
        session.scheduledAgentMafiaChatReplies,
        (reply) => dayjs(reply.dueAt).valueOf() <= this.clock.now().valueOf(),
      ),
      hydrationLocked,
    );
  }

  clearTimers(session: StoredGameSessionEntity) {
    this.cancelPublicSpeechReply(session);
    if (session.agentFinalDefenceTimer) this.clock.clearTimeout(session.agentFinalDefenceTimer);
    if (session.mafiaTargetFallbackTimer) this.clock.clearTimeout(session.mafiaTargetFallbackTimer);
    for (const timer of session.publicSpeechAgentTimers.values()) this.clock.clearTimeout(timer);
    for (const timer of session.mafiaChatReplyTimers.values()) this.clock.clearTimeout(timer);
    session.agentFinalDefenceTimer = undefined;
    session.publicSpeechAgentTimers.clear();
    session.mafiaChatReplyTimers.clear();
    session.mafiaTargetFallbackTimer = undefined;
    session.scheduledAgentPublicSpeeches = [];
    session.scheduledAgentFinalDefence = undefined;
    session.scheduledAgentMafiaChatReplies = [];
    session.scheduledMafiaTargetFallbackAt = undefined;
    session.autonomousPublicSpeechTurns = 0;
    session.lastAutonomousPublicSpeechSnapshotKey = undefined;
    session.autonomousPublicSpeechLimitReachedDiscussionKey = undefined;
  }

  private async recordAutonomousPublicSpeechLimitReached(
    session: StoredGameSessionEntity,
    snapshot: ReturnType<StoredGameSessionEntity['gameSession']['snapshot']>,
    hydrationLocked: boolean,
  ) {
    const discussionKey = JSON.stringify([snapshot.sessionId, snapshot.dayNumber, snapshot.phase]);
    if (session.autonomousPublicSpeechLimitReachedDiscussionKey === discussionKey) return;
    await this.commitAgentMutation(
      session,
      (current) => {
        const currentSnapshot = current.gameSession.snapshot();
        if (
          currentSnapshot.phase !== 'discussion' ||
          current.autonomousPublicSpeechTurns <
            gameSessionsConfig.maximumAutonomousPublicSpeechTurnsPerDiscussion ||
          current.autonomousPublicSpeechLimitReachedDiscussionKey === discussionKey
        ) {
          return false;
        }
        const recorded = current.gameSession.recordAutonomousPublicSpeechLimitReached(
          current.humanParticipantId,
        );
        if (recorded.isErr()) return false;
        current.autonomousPublicSpeechLimitReachedDiscussionKey = discussionKey;
        return true;
      },
      undefined,
      hydrationLocked,
    );
  }

  private livingParticipantIds(projection: MafiaGameProjection) {
    return pipe(
      projection.public.participants,
      filter(({ alive }) => alive),
      map(({ id }) => id),
    );
  }

  private livingSpecialRoleAgentParticipantIds(session: StoredGameSessionEntity) {
    return pipe(
      session.gameSession.snapshot().participants,
      filter(
        ({ id, alive, role }) =>
          id !== session.humanParticipantId && alive && (role === 'Doctor' || role === 'Police'),
      ),
      map(({ id }) => id),
    );
  }

  private async submitSpecialRoleNightAction(
    session: StoredGameSessionEntity,
    participantId: string,
    livingParticipantIds: readonly string[],
  ) {
    await this.agentContextFor(session, participantId).match(
      async (context) => {
        if (context.personal.nightAction) return;
        const targetParticipantIds =
          context.personal.role === 'Doctor'
            ? livingParticipantIds
            : filter(livingParticipantIds, (id) => id !== participantId);
        const decision = await this.phaseActionFor(session, context, targetParticipantIds);
        rememberAllegianceEstimates(
          agentMindFor(session.agentMinds, participantId),
          context,
          decision.allegianceEstimates,
          decision.strategy,
        );
        const targetParticipantId = decision.targetParticipantId;
        if (!targetParticipantId) return;
        const submittedAt = this.agentNightActionSubmittedAt(context);
        if (this.currentSessionFor(session) === session) {
          if (context.personal.role === 'Doctor')
            session.gameSession.submitDoctorProtection(
              participantId,
              targetParticipantId,
              submittedAt,
            );
          if (context.personal.role === 'Police')
            session.gameSession.submitPoliceInvestigation(
              participantId,
              targetParticipantId,
              submittedAt,
            );
          return;
        }
        await this.commitAgentMutation(
          session,
          (current) => {
            const currentProjection = current.gameSession.projectionFor(
              participantId,
              current.nextEventId,
            );
            if (currentProjection.isErr() || currentProjection.value.personal.nightAction)
              return false;
            return context.personal.role === 'Doctor'
              ? current.gameSession
                  .submitDoctorProtection(participantId, targetParticipantId, submittedAt)
                  .isOk()
              : current.gameSession
                  .submitPoliceInvestigation(participantId, targetParticipantId, submittedAt)
                  .isOk();
          },
          false,
        );
      },
      () => undefined,
    );
  }

  private async schedulePublicSpeechReply(
    session: StoredGameSessionEntity,
    scheduled: ScheduledAgentPublicSpeech,
  ) {
    const scheduledKey = scheduledAgentPublicSpeechKey(scheduled);
    if (session.publicSpeechAgentTimers.has(scheduledKey)) return;
    if (
      !session.scheduledAgentPublicSpeeches.some((candidate) =>
        this.sameScheduledSpeech(candidate, scheduled),
      )
    ) {
      session.scheduledAgentPublicSpeeches.push(scheduled);
    }

    const delayMs = Math.max(0, dayjs(scheduled.dueAt).diff(this.clock.now()));
    const timer = this.clock.setTimeout(() => {
      session.publicSpeechAgentTimers.delete(scheduledKey);
      if (this.isDraining(session)) return;
      void this.commitPublicSpeech(session, scheduled);
    }, delayMs);
    session.publicSpeechAgentTimers.set(scheduledKey, timer);
    timer.unref?.();
  }

  private scheduleMafiaChatReply(
    session: StoredGameSessionEntity,
    scheduled: ScheduledAgentMafiaChatReply,
  ) {
    if (session.mafiaChatReplyTimers.has(scheduled.id)) return;
    const delayMs = Math.max(0, dayjs(scheduled.dueAt).diff(this.clock.now()));
    const timer = this.clock.setTimeout(() => {
      session.mafiaChatReplyTimers.delete(scheduled.id);
      if (this.isDraining(session)) return;
      void this.commitMafiaChatReply(session, scheduled);
    }, delayMs);
    session.mafiaChatReplyTimers.set(scheduled.id, timer);
    timer.unref?.();
  }

  private async publishMafiaNightOpenings(session: StoredGameSessionEntity) {
    await this.submitMafiaAgentTarget(session);
    await this.publishMafiaAgentMessages(session, (context, targetName) =>
      this.decisionsFor(session).decideMafiaChatOpening(context, targetName),
    );
  }

  private submitNightActions(session: StoredGameSessionEntity, projection: MafiaGameProjection) {
    const sessionId = projection.sessionId;
    const phaseKey = JSON.stringify([
      sessionId,
      projection.public.dayNumber,
      projection.public.phase,
      projection.public.phaseDeadline,
    ]);
    const existing = this.nightActionRequests.get(sessionId);
    if (existing?.phaseKey === phaseKey) return existing.promise;

    const promise = this.performNightActions(session, projection).finally(() => {
      if (this.nightActionRequests.get(sessionId)?.promise === promise)
        this.nightActionRequests.delete(sessionId);
    });
    this.nightActionRequests.set(sessionId, { phaseKey, promise });
    return promise;
  }

  private submitVerdictActions(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
    agentIds: readonly string[],
  ) {
    const sessionId = projection.sessionId;
    const phaseKey = JSON.stringify([
      sessionId,
      projection.public.dayNumber,
      projection.public.phase,
      projection.public.phaseDeadline,
    ]);
    const existing = this.verdictRequests.get(sessionId);
    if (existing?.phaseKey === phaseKey) return existing.promise;

    const promise = this.performVerdictActions(session, projection, agentIds).finally(() => {
      if (this.verdictRequests.get(sessionId)?.promise === promise)
        this.verdictRequests.delete(sessionId);
    });
    this.verdictRequests.set(sessionId, { phaseKey, promise });
    return promise;
  }

  private async performVerdictActions(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
    agentIds: readonly string[],
  ) {
    const submittedAt = this.agentVoteSubmittedAt(projection);
    await Promise.all(
      map(agentIds, async (participantId) =>
        this.agentContextFor(session, participantId).match(
          async (context) => {
            if (context.personal.vote?.phase === 'verdict') return;
            const decision = await this.phaseActionFor(session, context, []);
            rememberAllegianceEstimates(
              agentMindFor(session.agentMinds, participantId),
              context,
              decision.allegianceEstimates,
              decision.strategy,
            );
            const verdict = decision.verdict;
            if (!verdict) return;
            await this.commitAgentMutation(
              session,
              (current) => {
                const currentProjection = current.gameSession.projectionFor(
                  participantId,
                  current.nextEventId,
                );
                if (
                  currentProjection.isErr() ||
                  currentProjection.value.personal.vote?.phase === 'verdict'
                )
                  return false;
                return current.gameSession
                  .submitVerdict(participantId, verdict, submittedAt)
                  .isOk();
              },
              false,
            );
          },
          () => undefined,
        ),
      ),
    );
  }

  private async performNightActions(
    session: StoredGameSessionEntity,
    projection: MafiaGameProjection,
  ) {
    const livingParticipantIds = this.livingParticipantIds(projection);
    await Promise.all([
      this.publishMafiaNightOpenings(session),
      ...map(this.livingSpecialRoleAgentParticipantIds(session), (participantId) =>
        this.submitSpecialRoleNightAction(session, participantId, livingParticipantIds),
      ),
    ]);
    this.scheduleMafiaTargetFallback(session, projection.public.phaseDeadline);
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

  private async publishMafiaAgentMessages(
    session: StoredGameSessionEntity,
    messageFor: (context: MafiaAgentContext, targetName: string) => Promise<string> | string,
  ) {
    await this.forEachMafiaAgent(session, async (participantId, context) => {
      if (this.hasMafiaChatForNight(session, participantId, context.public.dayNumber)) return;
      const targetParticipantId = await this.mafiaTargetFor(session, context);
      const targetName =
        targetParticipantId && this.participantNameFor(context, targetParticipantId);
      if (!targetParticipantId || !targetName) return;
      session.gameSession.submitMafiaChat(participantId, await messageFor(context, targetName));
    });
  }

  private async submitMafiaAgentTarget(session: StoredGameSessionEntity, now = this.clock.now()) {
    const selection = await this.mafiaAgentTargetSelection(session);
    if (!selection) return;
    if (this.currentSessionFor(session) === session) {
      session.gameSession.submitMafiaTarget(
        selection.participantId,
        selection.targetParticipantId,
        now,
      );
      return;
    }
    await this.commitAgentMutation(
      session,
      (current) => {
        if (current.gameSession.snapshot().mafiaTargetParticipantId) return false;
        return current.gameSession
          .submitMafiaTarget(selection.participantId, selection.targetParticipantId, now)
          .isOk();
      },
      false,
    );
  }

  private async mafiaAgentTargetSelection(
    session: StoredGameSessionEntity,
  ): Promise<MafiaAgentTargetSelection | undefined> {
    let coordinator: { participantId: string; context: MafiaAgentContext } | undefined;
    await this.forEachMafiaAgent(session, (participantId, context) => {
      coordinator ??= { participantId, context };
    });
    if (!coordinator) return undefined;
    const targetParticipantId = await this.mafiaTargetFor(session, coordinator.context);
    return targetParticipantId
      ? { participantId: coordinator.participantId, targetParticipantId }
      : undefined;
  }

  private async forEachMafiaAgent(
    session: StoredGameSessionEntity,
    action: (participantId: string, context: MafiaAgentContext) => void | Promise<void>,
  ) {
    for (const participantId of session.gameSession.livingMafiaAgentParticipantIds(
      session.humanParticipantId,
    )) {
      // oxlint-disable-next-line no-await-in-loop -- preserve decision ordering for durable scheduling.
      await this.agentContextFor(session, participantId).match(
        (context) => action(participantId, context),
        () => undefined,
      );
    }
  }

  private async mafiaTargetFor(session: StoredGameSessionEntity, context: MafiaAgentContext) {
    return (
      this.humanMafiaTarget(session) ??
      (context.personal.nightAction?.type === 'mafia-target'
        ? context.personal.nightAction.targetParticipantId
        : undefined) ??
      (await this.decisionsFor(session).selectMafiaTarget(context))
    );
  }

  private participantNameFor(context: MafiaAgentContext, participantId: string) {
    return find(context.public.participants, ({ id }) => id === participantId)?.name;
  }

  private hasMafiaChatForNight(
    session: StoredGameSessionEntity,
    participantId: string,
    dayNumber: number,
  ) {
    return Boolean(
      find(
        session.gameSession.snapshot().timeline,
        (item) =>
          item.type === 'mafia-chat' &&
          item.message.participantId === participantId &&
          item.message.dayNumber === dayNumber,
      ),
    );
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

  private async publicSpeechFor(
    session: StoredGameSessionEntity,
    participantId: string,
    request: PublicSpeechRequest,
  ) {
    return session.gameSession.agentSpeechContextFor(participantId).match(
      async (context) => {
        const mind = agentMindFor(session.agentMinds, participantId);
        const personalSnapshot = withAgentMind(context, mind);
        if (hasHandledSnapshot(mind, personalSnapshot)) return undefined;
        const decisionResult = await Promise.race([
          this.decisionsFor(session).decidePublicSpeech(personalSnapshot, {
            abortController: request.abortController,
          }),
          new Promise<undefined>((resolve) => {
            if (request.abortController.signal.aborted) {
              resolve(undefined);
              return;
            }
            request.abortController.signal.addEventListener('abort', () => resolve(undefined), {
              once: true,
            });
          }),
        ]);
        if (!decisionResult) return undefined;
        if (!this.isCurrentPublicSpeechRequest(session, request)) return undefined;
        rememberSnapshot(mind, personalSnapshot);
        return match(decisionResult)
          .with({ type: 'speak' }, (speechDecision) => {
            rememberAllegianceEstimates(
              mind,
              personalSnapshot,
              speechDecision.allegianceEstimates,
              speechDecision.strategy,
            );
            return {
              participantId,
              content: speechDecision.content,
              dueAt: agentChatDueAt({
                content: speechDecision.content,
                earliestAt: this.clock.now(),
              }),
            };
          })
          .with({ type: 'remain-silent' }, (silentDecision) => {
            rememberAllegianceEstimates(
              mind,
              personalSnapshot,
              silentDecision.allegianceEstimates,
              silentDecision.strategy,
            );
            return undefined;
          })
          .exhaustive();
      },
      () => undefined,
    );
  }

  private publicSpeechCandidateOrder(session: StoredGameSessionEntity) {
    const snapshot = session.gameSession.snapshot();
    const lastPublicChat = findLast(
      snapshot.timeline,
      (timelineItem) => timelineItem.type === 'chat',
    );
    const lastAgentParticipantId =
      lastPublicChat?.type === 'chat' &&
      lastPublicChat.message.participantId !== session.humanParticipantId
        ? lastPublicChat.message.participantId
        : undefined;
    const candidateIds = this.deterministicShuffle(
      session.gameSession.livingAgentParticipantIds(session.humanParticipantId),
      JSON.stringify([
        snapshot.sessionId,
        snapshot.dayNumber,
        snapshot.phase,
        snapshot.timeline.length,
      ]),
    );
    if (!lastAgentParticipantId) return candidateIds;
    const otherCandidates = filter(candidateIds, (id) => id !== lastAgentParticipantId);
    return otherCandidates.length > 0 ? [...otherCandidates, lastAgentParticipantId] : candidateIds;
  }

  private publicSpeechSnapshotKey(
    snapshot: ReturnType<StoredGameSessionEntity['gameSession']['snapshot']>,
  ) {
    return JSON.stringify([
      snapshot.sessionId,
      snapshot.dayNumber,
      snapshot.phase,
      snapshot.timeline.length,
    ]);
  }

  private beginPublicSpeechRequest(
    session: StoredGameSessionEntity,
    snapshotKey: string,
  ): PublicSpeechRequest {
    this.cancelPublicSpeechReply(session);
    const request = { abortController: new AbortController(), snapshotKey };
    this.publicSpeechRequests.set(session.gameSession.snapshot().sessionId, request);
    return request;
  }

  private hasPublicSpeechRequest(session: StoredGameSessionEntity, snapshotKey: string) {
    const request = this.publicSpeechRequests.get(session.gameSession.snapshot().sessionId);
    return request?.snapshotKey === snapshotKey && !request.abortController.signal.aborted;
  }

  private isCurrentPublicSpeechRequest(
    session: StoredGameSessionEntity,
    request: PublicSpeechRequest,
  ) {
    return (
      !request.abortController.signal.aborted &&
      this.publicSpeechRequests.get(session.gameSession.snapshot().sessionId) === request &&
      this.publicSpeechSnapshotKey(session.gameSession.snapshot()) === request.snapshotKey
    );
  }

  private releasePublicSpeechRequest(
    session: StoredGameSessionEntity,
    request: PublicSpeechRequest,
  ) {
    const sessionId = session.gameSession.snapshot().sessionId;
    if (this.publicSpeechRequests.get(sessionId) === request)
      this.publicSpeechRequests.delete(sessionId);
  }

  private deterministicShuffle(candidateIds: readonly string[], seedText: string) {
    const shuffled = [...candidateIds];
    let seed = 0;
    for (const character of seedText) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      const swapIndex = seed % (index + 1);
      const current = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = current;
    }
    return shuffled;
  }

  private sameScheduledSpeech(left: ScheduledAgentPublicSpeech, right: ScheduledAgentPublicSpeech) {
    return scheduledAgentPublicSpeechKey(left) === scheduledAgentPublicSpeechKey(right);
  }

  private agentContextFor(session: StoredGameSessionEntity, participantId: string) {
    return session.gameSession.agentSpeechContextFor(participantId).map((context) => {
      const mind = agentMindFor(session.agentMinds, participantId);
      const personalSnapshot = withAgentMind(context, mind);
      rememberSnapshot(mind, personalSnapshot);
      return personalSnapshot;
    });
  }

  private decisionsFor(session: StoredGameSessionEntity) {
    return this.agentDecisions.forLanguage?.(session.outputLanguage ?? 'ko') ?? this.agentDecisions;
  }

  private async phaseActionFor(
    session: StoredGameSessionEntity,
    context: MafiaAgentContext,
    candidateParticipantIds: readonly string[],
  ) {
    const decision = await this.decisionsFor(session).decidePhaseAction?.(
      context,
      candidateParticipantIds,
    );
    if (decision) return decision;
    return {
      targetParticipantId: candidateParticipantIds[0],
      verdict: 'spare' as const,
    };
  }

  private agentVoteSubmittedAt(projection: MafiaGameProjection) {
    // A vote request belongs to the phase in which its personal snapshot was produced.
    // The lifecycle awaits this work before resolving the phase, so retain that ownership
    // when the model responds after the visible countdown reaches zero.
    return dayjs(projection.public.phaseDeadline).subtract(1, 'millisecond').toDate();
  }

  private agentNightActionSubmittedAt(context: MafiaAgentContext) {
    return dayjs(context.public.phaseDeadline).subtract(1, 'millisecond').toDate();
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
        const submitted = current.gameSession.submitPublicSpeech(
          scheduled.participantId,
          scheduled.content,
          dayjs(scheduled.dueAt).toDate(),
        );
        if (submitted.isErr()) return false;
        current.autonomousPublicSpeechTurns += 1;
        return true;
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
        current.mafiaChatReplyTimers.delete(scheduled.id);
        const pending = find(
          current.scheduledAgentMafiaChatReplies,
          (candidate) => candidate.id === scheduled.id,
        );
        if (!pending) return false;
        if (pending.phaseKey !== mafiaNightPhaseKey(current.gameSession.snapshot())) {
          current.scheduledAgentMafiaChatReplies = filter(
            current.scheduledAgentMafiaChatReplies,
            (candidate) => candidate.id !== pending.id,
          );
          return true;
        }
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

  private async commitMafiaTargetFallback(
    session: StoredGameSessionEntity,
    fallbackAt: string,
    schedulePhaseTransition = true,
    hydrationLocked = false,
  ) {
    const selection = await this.mafiaAgentTargetSelection(session);
    return this.commitAgentMutation(
      session,
      (current) => {
        current.mafiaTargetFallbackTimer = undefined;
        if (current.scheduledMafiaTargetFallbackAt !== fallbackAt) return false;
        current.scheduledMafiaTargetFallbackAt = undefined;
        if (current.gameSession.snapshot().mafiaTargetParticipantId || !selection) return false;
        return current.gameSession
          .submitMafiaTarget(
            selection.participantId,
            selection.targetParticipantId,
            dayjs(fallbackAt).toDate(),
          )
          .isOk();
      },
      schedulePhaseTransition,
      hydrationLocked,
    );
  }
}
