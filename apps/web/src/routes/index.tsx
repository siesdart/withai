import { Button } from '@repo/ui/components/button';
import { createFileRoute, Link } from '@tanstack/react-router';
import { LockKeyhole } from 'lucide-react';

import { activeMafiaSessionOptions } from '@/features/mafia-session/hooks/options/active-mafia-session-options';
import { Head } from '@/head';

import { GameArticle } from './-components/game-article';
import { MafiaArticle } from './-components/mafia-article';

export const Route = createFileRoute('/')({
  component: Index,
  loader: ({ context }) =>
    void context.queryClient.query({
      ...activeMafiaSessionOptions(),
      staleTime: 'static',
    }),
});

function Index() {
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
              <MafiaArticle />
              <GameArticle
                number="02"
                title="예정"
                description="다음 추리 테이블을 준비하고 있어요."
                variant="upcoming"
              >
                <Button variant="outline" disabled>
                  <LockKeyhole data-icon="inline-start" />
                  준비 중입니다
                </Button>
              </GameArticle>
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
      </main>
    </>
  );
}
