import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { LicenseList } from '@/features/legal/components/license-list';
import { Head } from '@/head';
export const Route = createFileRoute('/licenses')({
  component: LicensesPage,
});

function LicensesPage() {
  return (
    <>
      <Head
        title="오픈소스 라이선스 | WithAI"
        description="WithAI를 구성하는 오픈소스 패키지의 라이선스와 저작권 정보를 안내합니다."
      />
      <main className="min-h-dvh overflow-x-hidden bg-[#e9e3d6] px-4 py-4 text-[#22221e] sm:px-8 sm:py-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col">
          <nav className="flex items-center justify-between border-b-2 border-[#22221e] pb-4">
            <Link to="/" className="text-lg font-bold tracking-[-0.045em] hover:text-[#a43b31]">
              WithAI
            </Link>
            <span className="text-xs tracking-[0.16em] text-[#625e55] uppercase">
              Open Source Notices
            </span>
          </nav>

          <section className="py-8 sm:py-12">
            <Link
              to="/"
              className="mb-6 inline-flex items-center gap-1.5 border border-[#22221e] bg-[#f4efe7] px-3 py-1.5 text-xs font-semibold text-[#22221e] shadow-xs transition-colors hover:bg-[#e9e3d6]"
            >
              <ArrowLeft className="h-4 w-4" />
              메인으로 돌아가기
            </Link>

            <header className="mb-8">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
                오픈소스 소프트웨어 고지
              </h1>
              <p className="mt-3 max-w-2xl text-base text-[#625e55]">
                WithAI 프로젝트는 전 세계 수많은 오픈소스 기여자들의 소프트웨어를 기반으로
                구축되었습니다. 각 오픈소스 패키지의 라이선스 및 저작권 정보를 안내합니다.
              </p>
            </header>

            <LicenseList />
          </section>
        </div>
      </main>
    </>
  );
}
