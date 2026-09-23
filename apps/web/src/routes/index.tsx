/* oxlint-disable react-perf/jsx-no-jsx-as-prop, react-perf/jsx-no-new-function-as-prop -- Base UI's render contract composes the typed route link and the card owns its dialog-opening intent. */

import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight, LockKeyhole } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import { activeMafiaSessionOptions } from '@/features/mafia-session/hooks/options/active-mafia-session-options';
import { useActiveMafiaSession } from '@/features/mafia-session/hooks/use-active-mafia-session';
import { Head } from '@/head';

const MafiaStartDialog = lazy(() =>
  import('@/features/game-start/components/mafia-start-dialog').then(
    ({ MafiaStartDialog: LoadedMafiaStartDialog }) => ({ default: LoadedMafiaStartDialog }),
  ),
);

export const Route = createFileRoute('/')({
  component: Index,
  loader: ({ context }) =>
    void context.queryClient.query({
      ...activeMafiaSessionOptions(),
      staleTime: 'static',
    }),
});

function Index() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const navigate = useNavigate({ from: '/' });
  const { isChecking, session } = useActiveMafiaSession();

  return (
    <>
      <Head
        title="WithAI | 부담 없이 시작하는, 나만의 추리 테이블"
        description="낯선 사람들 앞에서 빠르게 말하고 추리해야 한다는 부담 없이, AI 참가자들과 당신의 속도로 추론 게임을 즐겨 보세요."
      />
      <main className="min-h-dvh overflow-x-hidden bg-[#e9e3d6] px-4 py-4 text-[#22221e] sm:px-8 sm:py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col">
          <nav className="flex items-center justify-between border-b-2 border-[#22221e] pb-4">
            <span className="text-lg font-bold tracking-[-0.045em]">WithAI</span>
            <span className="text-xs tracking-[0.16em] text-[#625e55] uppercase">
              Reason at your pace
            </span>
          </nav>

          <section className="py-16 sm:py-24" aria-labelledby="home-title">
            <p className="mb-5 text-sm font-medium text-[#a43b31]">혼자여도 충분히 깊게</p>
            <h1
              id="home-title"
              className="max-w-5xl text-5xl font-bold tracking-[-0.065em] sm:text-7xl"
            >
              부담 없이 시작하는,
              <br />
              나만의 추리 테이블
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#625e55] sm:text-lg">
              낯선 사람들 앞에서 빠르게 말하고 추리해야 한다는 부담 없이, AI 참가자들과 당신의
              속도로 추론 게임을 즐겨 보세요.
            </p>
          </section>

          <section
            className="border-t-2 border-[#22221e] py-8 sm:py-10"
            aria-labelledby="games-title"
          >
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 id="games-title" className="text-2xl font-bold tracking-[-0.04em]">
                게임 선택
              </h2>
            </div>
            <div className="grid grid-flow-dense gap-4 md:grid-cols-2">
              <article className="flex min-h-72 flex-col justify-between border-2 border-[#22221e] bg-[#f4efe7] p-5 transition-transform duration-500 hover:-translate-y-1 sm:p-7">
                <div>
                  <span className="text-sm text-[#a43b31]">01</span>
                  <h3 className="mt-8 text-3xl font-bold tracking-tighter">마피아 게임</h3>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-[#625e55]">
                    대화 속 단서를 모아, 숨은 마피아를 찾아내세요.
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap items-start gap-2">
                  {session ? (
                    <Button onClick={() => navigate({ to: '/mafia' })}>
                      <ChevronRight data-icon="inline-end" />
                      게임 계속하기
                    </Button>
                  ) : (
                    <Button disabled={isChecking} onClick={() => setIsDialogOpen(true)}>
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
              </article>
              <article className="flex min-h-72 flex-col justify-between border border-dashed border-[#22221e]/45 bg-[#e9e3d6] p-5 text-[#625e55] sm:p-7">
                <div>
                  <span className="text-sm">02</span>
                  <h3 className="mt-8 text-3xl font-bold tracking-tighter">예정</h3>
                  <p className="mt-3 max-w-sm text-sm leading-6">
                    다음 추리 테이블을 준비하고 있어요.
                  </p>
                </div>
                <Button variant="outline" disabled>
                  <LockKeyhole data-icon="inline-start" />
                  준비 중입니다
                </Button>
              </article>
            </div>
          </section>

          <footer className="mt-16 border-t-2 border-[#22221e] pt-8 pb-12 text-xs text-[#625e55]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <span className="font-bold tracking-tight text-[#22221e]">WithAI</span>
                <p>
                  본 서비스의 모든 AI 참가자는 Google Gemini 대형 언어 모델을 기반으로 구동되며,
                  <br className="hidden sm:inline" />
                  모든 발언과 추리는 인공지능에 의해 실시간으로 자동 생성됩니다.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[#22221e]">
                <Link
                  to="/terms"
                  className="inline-flex items-center underline underline-offset-4 transition-colors hover:text-[#a43b31]"
                >
                  서비스 이용약관
                </Link>
                <span className="text-[#22221e]/30">|</span>
                <Link
                  to="/privacy"
                  className="inline-flex items-center underline underline-offset-4 transition-colors hover:text-[#a43b31]"
                >
                  개인정보 처리방침
                </Link>
                <span className="text-[#22221e]/30">|</span>
                <Link
                  to="/licenses"
                  className="inline-flex items-center underline underline-offset-4 transition-colors hover:text-[#a43b31]"
                >
                  오픈소스 라이선스
                </Link>
              </div>
            </div>
            <p className="mt-6 text-[#625e55]/80">
              &copy; {new Date().getFullYear()} WithAI. All rights reserved.
            </p>
          </footer>
        </div>
        <Suspense>
          {isDialogOpen ? (
            <MafiaStartDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
          ) : null}
        </Suspense>
      </main>
    </>
  );
}
