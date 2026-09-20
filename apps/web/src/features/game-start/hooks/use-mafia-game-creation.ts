import type { MafiaOutputLanguage } from '@repo/mafia/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';

import { MafiaGameSessionClient } from '@/features/mafia-session/api/client';
import { isUnavailableGameSession } from '@/features/mafia-session/api/error';
import { useGameSessionStore } from '@/features/mafia-session/store/game-session';

import { gameSessionSnapshotQueryKey } from '../../mafia-session/hooks/options/game-session-snapshot-options';
import { guestPlayAllowanceOptions } from './guest-play-allowance-options';

const defaultNameFor = (outputLanguage: MafiaOutputLanguage) =>
  outputLanguage === 'ko' ? '플레이어' : 'Player';

export function useMafiaGameCreation() {
  const navigate = useNavigate({ from: '/' });
  const queryClient = useQueryClient();
  const [humanName, setHumanName] = useState('');
  const [outputLanguage, setOutputLanguage] = useState<MafiaOutputLanguage>('ko');
  const [creationError, setCreationError] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);

  const startGame = useCallback(async () => {
    setCreationError(undefined);
    setIsCreating(true);
    const settings = {
      humanName: humanName.trim() || defaultNameFor(outputLanguage),
      outputLanguage,
    };
    const state = useGameSessionStore.getState();
    const firstResult = await MafiaGameSessionClient.createSession(
      state.ensureCreationKey(),
      settings,
    );
    const result =
      firstResult.isErr() && isUnavailableGameSession(firstResult.error)
        ? (state.resetCreationKey(),
          await MafiaGameSessionClient.createSession(state.ensureCreationKey(), settings))
        : firstResult;
    await result.match(
      async () => {
        queryClient.removeQueries({ queryKey: gameSessionSnapshotQueryKey, exact: true });
        useGameSessionStore.getState().setGameSession(outputLanguage);
        await navigate({ to: '/mafia' });
      },
      () => {
        void queryClient.invalidateQueries(guestPlayAllowanceOptions);
        setCreationError('게임을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
        setIsCreating(false);
      },
    );
  }, [humanName, navigate, outputLanguage, queryClient]);

  return {
    humanName,
    outputLanguage,
    creationError,
    isCreating,
    setHumanName,
    setOutputLanguage,
    startGame,
  };
}
