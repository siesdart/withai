import dayjs from 'dayjs';

import { gameSessionsConfig } from '../application/game-sessions.config.js';

type AgentChatScheduleInput = {
  content: string;
  earliestAt: Date;
};

/**
 * Calculates when a decided Agent message should become public.  Generation is
 * deliberately not part of this calculation: a gateway may answer immediately
 * while the Game Session still preserves a human-paced conversation.
 */
export const agentChatDueAt = ({ content, earliestAt }: AgentChatScheduleInput) => {
  const characterCount = readableContentMetrics(content);
  const delayMs = characterCount * gameSessionsConfig.agentChatTypingMsPerCharacter;
  return dayjs(earliestAt).add(delayMs, 'millisecond').toISOString();
};

const readableContentMetrics = (content: string) => {
  let characterCount = 0;
  for (const character of content) {
    if (/\s/u.test(character)) continue;
    characterCount += 1;
  }
  return characterCount;
};
