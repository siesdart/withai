import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { MafiaSessionEntryActions } from '@/features/mafia-session/components/entry/mafia-session-entry-actions';

import { GameArticle } from './game-article';

export function MafiaArticle() {
  const navigate = useNavigate({ from: '/' });
  const openSession = useCallback(() => {
    void navigate({ to: '/mafia' });
  }, [navigate]);

  return (
    <GameArticle
      number="01"
      title="마피아 게임"
      description="대화 속 단서를 모아, 숨은 마피아를 찾아내세요."
      variant="featured"
    >
      <MafiaSessionEntryActions onOpenSession={openSession} />
    </GameArticle>
  );
}
