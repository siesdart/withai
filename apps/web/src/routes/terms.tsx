import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { TermsOfServiceContent } from '@/features/legal/components/terms-of-service-content';
import { Head } from '@/head';

export const Route = createFileRoute('/terms')({
  component: TermsPage,
});

function TermsPage() {
  return (
    <>
      <Head
        title="서비스 이용약관 | WithAI"
        description="WithAI 서비스 이용에 필요한 약관과 이용자의 권리·의무를 안내합니다."
      />
      <main className="min-h-dvh overflow-x-hidden bg-[#e9e3d6] px-4 py-4 text-[#22221e] sm:px-8 sm:py-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col">
          <nav className="flex items-center justify-between border-b-2 border-[#22221e] pb-4">
            <Link to="/" className="text-lg font-bold tracking-[-0.045em] hover:text-[#a43b31]">
              WithAI
            </Link>
            <span className="text-xs tracking-[0.16em] text-[#625e55] uppercase">
              Terms of Service
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

            <div className="border-2 border-[#22221e] bg-[#f4efe7] p-6 shadow-sm sm:p-10">
              <TermsOfServiceContent />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
