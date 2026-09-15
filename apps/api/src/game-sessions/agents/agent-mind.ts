import { randomInt } from 'node:crypto';

import type { MafiaAgentContext, MafiaGameSession } from '@repo/mafia';
import { filter, find, map, pipe, sortBy } from 'remeda';

export type AgentAllegianceEstimate = {
  participantId: string;
  mafiaProbability: number;
  roleProbabilities?: {
    policeProbability: number;
    doctorProbability: number;
  };
  basis: string;
};

export type AgentMemory = {
  revision: number;
  allegianceEstimates: AgentAllegianceEstimate[];
  strategy: string;
  lastSnapshotKey?: string;
};

export type AgentMind = {
  persona: string;
  memory: AgentMemory;
};

const socialDeductionPersonas = [
  'a forensic auditor: separates facts from claims, tracks contradictions, and updates proportionally when a consistent claim accumulates support',
  'a warm mediator: draws quieter people in, lowers the temperature, and looks for the account that best reconciles disagreement',
  'a blunt prosecutor: names a suspect early, presses for a direct answer, and is comfortable challenging a popular read',
  'a cautious skeptic: tests tidy stories and majorities, keeps alternatives alive, and updates position when the balance of evidence changes',
  'a coalition builder: notices who is persuadable, tests whether a temporary alliance can form, and frames choices around the group’s next move',
  'a contrarian: deliberately stress-tests the leading theory, asks what would falsify it, and resists joining a pile-on without a distinct reason',
  'a pattern hunter: compares timing, wording, and incentives across the public record, then turns a small inconsistency into a focused question',
  'a guarded survivor: reveals little, probes before taking ownership of a theory, and prefers reversible moves until pressure forces a stand',
  'a high-empathy reader: pays attention to discomfort and relational friction, but presents those impressions as tentative questions rather than facts',
  'a strategic gambler: takes a calculated social risk when the table is stalled, creates a sharp choice, and accepts being challenged in return',
  'a process referee: keeps discussion anchored to answerable claims, distinguishes uncertainty from contradiction, and cares more about a fair test than sounding certain',
  'a charismatic storyteller: makes one clear theory memorable, recruits attention through vivid but grounded framing, and quickly revises it when the record breaks it',
] as const;

const emptyMemory = (): AgentMemory => ({
  revision: 0,
  allegianceEstimates: [],
  strategy: 'Use current evidence and allegiance estimates to make the next legal move.',
});

export const createAgentMinds = (gameSession: MafiaGameSession, humanParticipantId: string) => {
  const minds: Record<string, AgentMind> = {};
  for (const participant of gameSession.snapshot().participants) {
    if (participant.id === humanParticipantId) continue;
    minds[participant.id] = {
      persona: personaFor(participant.name),
      memory: emptyMemory(),
    };
  }
  return minds;
};

export const agentMindFor = (
  minds: Record<string, AgentMind>,
  participantId: string,
): AgentMind => {
  const existing = minds[participantId];
  if (existing) return existing;
  const created: AgentMind = {
    persona: personaFor(participantId),
    memory: emptyMemory(),
  };
  minds[participantId] = created;
  return created;
};

const personaFor = (name: string) => {
  const persona =
    socialDeductionPersonas[randomInt(socialDeductionPersonas.length)] ??
    socialDeductionPersonas[0];
  return `${name} is ${persona}.`;
};

export const withAgentMind = (context: MafiaAgentContext, mind: AgentMind): MafiaAgentContext => {
  pruneKnownAllegianceEstimates(mind, context);
  return {
    ...context,
    persona: mind.persona,
    memory: mind.memory,
    snapshotKey: snapshotKeyFor(context),
  };
};

export const hasHandledSnapshot = (mind: AgentMind, context: MafiaAgentContext) =>
  mind.memory.lastSnapshotKey === (context.snapshotKey ?? snapshotKeyFor(context));

export const rememberSnapshot = (mind: AgentMind, context: MafiaAgentContext) => {
  const snapshotKey = context.snapshotKey ?? snapshotKeyFor(context);
  if (mind.memory.lastSnapshotKey === snapshotKey) return;
  mind.memory = {
    ...mind.memory,
    revision: mind.memory.revision + 1,
    lastSnapshotKey: snapshotKey,
  };
};

export const rememberAllegianceEstimates = (
  mind: AgentMind,
  context: MafiaAgentContext,
  allegianceEstimates: readonly AgentAllegianceEstimate[] | undefined,
  strategy?: string,
) => {
  const eligibleParticipantIds = new Set(
    map(
      filter(
        context.public.participants,
        ({ id }) => id !== context.participant.id && hasUnresolvedRole(context, id),
      ),
      ({ id }) => id,
    ),
  );
  const updates = new Map(
    map(allegianceEstimates ?? [], (estimate) => [estimate.participantId, estimate] as const),
  );
  const retained = pipe(
    mind.memory.allegianceEstimates,
    filter(({ participantId }) => eligibleParticipantIds.has(participantId)),
    map((estimate) => ({
      ...estimate,
      ...(isKnownCitizenAllegiance(context, estimate.participantId) ? { mafiaProbability: 0 } : {}),
      ...(estimate.roleProbabilities
        ? { roleProbabilities: normalizeCitizenRoleProbabilities(estimate.roleProbabilities) }
        : {}),
    })),
  );
  const merged = new Map(map(retained, (estimate) => [estimate.participantId, estimate] as const));
  for (const [participantId, estimate] of updates) {
    if (!eligibleParticipantIds.has(participantId)) continue;
    merged.set(participantId, {
      participantId,
      mafiaProbability: isKnownCitizenAllegiance(context, participantId)
        ? 0
        : normalizeProbability(estimate.mafiaProbability),
      ...(estimate.roleProbabilities
        ? {
            roleProbabilities: {
              ...normalizeCitizenRoleProbabilities(estimate.roleProbabilities),
            },
          }
        : {}),
      basis: estimate.basis.trim().slice(0, 160),
    });
  }
  mind.memory = {
    ...mind.memory,
    allegianceEstimates: sortBy([...merged.values()], ({ participantId }) => participantId),
    strategy: strategy?.trim().slice(0, 240) || mind.memory.strategy,
  };
};

const pruneKnownAllegianceEstimates = (mind: AgentMind, context: MafiaAgentContext) =>
  rememberAllegianceEstimates(mind, context, undefined);

const hasUnresolvedRole = (context: MafiaAgentContext, participantId: string) => {
  const knownRoleEntry = find(
    context.personal.knownRoles,
    (knownRole) => knownRole.participantId === participantId,
  );
  return !knownRoleEntry || knownRoleEntry.role === 'Citizen';
};

const isKnownCitizenAllegiance = (context: MafiaAgentContext, participantId: string) =>
  context.personal.knownRoles.some(
    (knownRole) => knownRole.participantId === participantId && knownRole.role === 'Citizen',
  );

const normalizeProbability = (probability: number) =>
  Math.round(Math.min(100, Math.max(0, probability)));

const normalizeCitizenRoleProbabilities = ({
  policeProbability,
  doctorProbability,
}: NonNullable<AgentAllegianceEstimate['roleProbabilities']>) => {
  const normalizedPoliceProbability = normalizeProbability(policeProbability);
  return {
    policeProbability: normalizedPoliceProbability,
    doctorProbability: Math.min(
      100 - normalizedPoliceProbability,
      normalizeProbability(doctorProbability),
    ),
  };
};

const snapshotKeyFor = (context: MafiaAgentContext) =>
  JSON.stringify([
    context.public.dayNumber,
    context.public.phase,
    context.public.phaseDeadline,
    context.personal.vote,
    context.personal.nightAction,
    context.timeline.length,
  ]);
