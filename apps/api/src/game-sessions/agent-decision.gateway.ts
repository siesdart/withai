import { randomInt } from 'node:crypto';

import type { MafiaAgentSpeechContext } from '@repo/mafia';
import { filter, findLast } from 'remeda';

export type AgentPublicSpeechDecision =
  | { type: 'speak'; content: string; delayMs: number }
  | { type: 'remain-silent' };

export type AgentFinalDefence = {
  opening: string;
  followUp: string;
};

export type AgentDecisionGateway = {
  decidePublicSpeech(context: MafiaAgentSpeechContext): AgentPublicSpeechDecision;
  decideFinalDefence(context: MafiaAgentSpeechContext): AgentFinalDefence;
  decideMafiaChatOpening(context: MafiaAgentSpeechContext, targetName: string): string;
  decideMafiaChatReply(context: MafiaAgentSpeechContext, targetName: string): string;
  selectMafiaTarget(context: MafiaAgentSpeechContext): string | undefined;
};

export const agentDecisionGateway = Symbol('agent-decision-gateway');

export class DeterministicAgentDecisionGateway implements AgentDecisionGateway {
  decidePublicSpeech(context: MafiaAgentSpeechContext): AgentPublicSpeechDecision {
    const latestChat = findLast(context.timeline, (item) => item.type === 'chat');
    if (!latestChat || latestChat.message.participantId === context.participant.id) {
      return { type: 'remain-silent' };
    }

    const focus = context.persona.split(' is ')[1] ?? 'careful';
    const stance =
      context.personal.allegiance === 'Mafia'
        ? 'I would avoid rushing to a nomination.'
        : 'I want a concrete read before we nominate.';

    return {
      type: 'speak',
      content: `As someone ${focus}, ${stance}`,
      delayMs: Number.parseInt(context.participant.id.split('-')[1] ?? '1', 10) * 100,
    };
  }

  decideFinalDefence(context: MafiaAgentSpeechContext): AgentFinalDefence {
    const focus = context.persona.split(' is ')[1] ?? 'careful';
    const stance =
      context.personal.allegiance === 'Mafia'
        ? 'I ask you not to rush to judgment.'
        : 'I ask you to judge the evidence carefully.';

    return {
      opening: `As someone ${focus}, ${stance}`,
      followUp: `My position has not changed; please weigh the facts.`,
    };
  }
  decideMafiaChatOpening(context: MafiaAgentSpeechContext, targetName: string): string {
    return `My proposal for tonight is ${targetName}. We should keep the plan focused.`;
  }
  decideMafiaChatReply(context: MafiaAgentSpeechContext, targetName: string): string {
    return `I have considered that. I will commit my action to ${targetName}.`;
  }
  selectMafiaTarget(context: MafiaAgentSpeechContext): string | undefined {
    const targetParticipants = filter(context.public.participants, ({ alive }) => alive);
    return targetParticipants[randomInt(targetParticipants.length)]?.id;
  }
}
