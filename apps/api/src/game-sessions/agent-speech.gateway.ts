import type { MafiaAgentSpeechContext } from '@repo/mafia';

export type AgentSpeechDecision =
  | { type: 'speak'; content: string; delayMs: number }
  | { type: 'remain-silent' };

export type AgentSpeechGateway = {
  decide(context: MafiaAgentSpeechContext): AgentSpeechDecision;
};

export const agentSpeechGateway = Symbol('agent-speech-gateway');

export class DeterministicAgentSpeechGateway implements AgentSpeechGateway {
  decide(context: MafiaAgentSpeechContext): AgentSpeechDecision {
    const latestMessage = context.public.chat.at(-1);
    if (!latestMessage || latestMessage.participantId === context.participant.id) {
      return { type: 'remain-silent' };
    }

    const focus = context.persona.split(' is ')[1] ?? 'careful';
    const stance =
      context.personal.allegiance === 'Mafia'
        ? 'I would avoid rushing to a nomination.'
        : 'I want a concrete read before we nominate.';

    return {
      type: 'speak',
      content: `${context.participant.name}: As someone ${focus}, ${stance}`,
      delayMs: Number.parseInt(context.participant.id.split('-')[1] ?? '1', 10) * 100,
    };
  }
}
