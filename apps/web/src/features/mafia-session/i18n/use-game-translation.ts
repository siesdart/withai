import { useTranslation } from 'react-i18next';

import { useGameSessionStore } from '../store/game-session';
import { gameI18n } from './game-i18n';

export function useGameTranslation() {
  const language = useGameSessionStore((state) => state.outputLanguage) ?? 'ko';
  const translation = useTranslation('game', { i18n: gameI18n, lng: language });

  return { language, t: translation.t };
}
