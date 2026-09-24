import type { MafiaOutputLanguage } from '@repo/api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { MafiaGameSessionClient } from '../../api/client';
import { isUnavailableGameSession } from '../../api/error';
import { useGameSessionStore } from '../../store/game-session';
import { gameSessionSnapshotQueryKey } from '../options/game-session-snapshot-options';
import { guestPlayAllowanceOptions } from '../options/guest-play-allowance-options';

const defaultNameFor = (outputLanguage: MafiaOutputLanguage) =>
  outputLanguage === 'ko' ? '플레이어' : 'Player';

export function useMafiaGameCreation(onCreated: () => void) {
  const queryClient = useQueryClient();
  const humanName = useGameSessionStore((state) => state.playerName);
  const setHumanName = useGameSessionStore((state) => state.setPlayerName);
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
    state.setPlayerName(settings.humanName);
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
        onCreated();
      },
      () => {
        void queryClient.invalidateQueries(guestPlayAllowanceOptions());
        setCreationError('게임을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
        setIsCreating(false);
      },
    );
  }, [humanName, onCreated, outputLanguage, queryClient]);

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
