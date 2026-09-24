import { useForesight } from '@foresightjs/react';
import { Button } from '@repo/ui/components/button';
import { noop, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { lazy, Suspense, useCallback, useState } from 'react';

import { useActiveMafiaSession } from '../../hooks/entry/use-active-mafia-session';
import { guestPlayAllowanceOptions } from '../../hooks/options/guest-play-allowance-options';
import { MafiaStartDialogSkeleton } from './mafia-start-dialog-skeleton';

const loadMafiaStartDialog = () =>
  import('./mafia-start-dialog').then(({ MafiaStartDialog }) => ({
    default: MafiaStartDialog,
  }));
const MafiaStartDialog = lazy(loadMafiaStartDialog);
const mafiaStartDialogFallback = <MafiaStartDialogSkeleton />;

type MafiaSessionEntryActionsProps = {
  onOpenSession: () => void;
};

export function MafiaSessionEntryActions({ onOpenSession }: MafiaSessionEntryActionsProps) {
  const queryClient = useQueryClient();
  const { isChecking, session } = useActiveMafiaSession();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const openStartDialog = useCallback(() => setIsDialogOpen(true), []);
  const prefetch = useCallback(() => {
    void loadMafiaStartDialog();
    void queryClient.query(guestPlayAllowanceOptions()).catch(noop);
  }, [queryClient]);

  const { elementRef } = useForesight({ callback: prefetch });

  return (
    <>
      <div className="mt-8 flex flex-wrap items-start gap-2">
        {session ? (
          <Button onClick={onOpenSession}>
            <ChevronRight data-icon="inline-end" />
            게임 계속하기
          </Button>
        ) : (
          <Button disabled={isChecking} onClick={openStartDialog} ref={elementRef}>
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

      <Suspense fallback={mafiaStartDialogFallback}>
        {isDialogOpen ? (
          <MafiaStartDialog
            open={isDialogOpen}
            onCreated={onOpenSession}
            onOpenChange={setIsDialogOpen}
          />
        ) : null}
      </Suspense>
    </>
  );
}
