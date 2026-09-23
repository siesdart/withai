import { Button } from '@repo/ui/components/button';
import { noop, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { lazy, Suspense, useCallback, useState } from 'react';

import { guestPlayAllowanceOptions } from '../../hooks/options/guest-play-allowance-options';
import { useActiveMafiaSession } from '../../hooks/use-active-mafia-session';
import { GameArticle } from '../game-article';

const MafiaStartDialog = lazy(() =>
  import('./mafia-start-dialog').then(({ MafiaStartDialog: LoadedMafiaStartDialog }) => ({
    default: LoadedMafiaStartDialog,
  })),
);

export function MafiaArticle() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/' });
  const { isChecking, session } = useActiveMafiaSession();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const resume = useCallback(() => navigate({ to: '/mafia' }), [navigate]);
  const start = useCallback(() => setIsDialogOpen(true), [setIsDialogOpen]);
  const prefetch = useCallback(() => {
    void import('./mafia-start-dialog');
    void queryClient.query(guestPlayAllowanceOptions()).catch(noop);
  }, [queryClient]);

  return (
    <GameArticle
      number="01"
      title="마피아 게임"
      description="대화 속 단서를 모아, 숨은 마피아를 찾아내세요."
      variant="featured"
    >
      <div className="mt-8 flex flex-wrap items-start gap-2">
        {session ? (
          <Button onClick={resume}>
            <ChevronRight data-icon="inline-end" />
            게임 계속하기
          </Button>
        ) : (
          <Button disabled={isChecking} onClick={start} onMouseEnter={prefetch}>
            <ChevronRight data-icon="inline-end" />
            {isChecking ? '진행 중인 게임 확인 중…' : '게임 시작'}
          </Button>
        )}
        {session ? (
          <Button variant="outline" disabled>
            진행 중인 게임을 마친 뒤 새 게임을 시작할 수 있어요.
          </Button>
        ) : null}
      </div>

      <Suspense>
        {isDialogOpen ? (
          <MafiaStartDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
        ) : null}
      </Suspense>
    </GameArticle>
  );
}
