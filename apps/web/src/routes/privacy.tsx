import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { PrivacyPolicyContent } from '@/features/legal/components/privacy-policy-content';

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#e9e3d6] px-4 py-4 text-[#22221e] sm:px-8 sm:py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col">
        <nav className="flex items-center justify-between border-b-2 border-[#22221e] pb-4">
          <Link to="/" className="text-lg font-bold tracking-[-0.045em] hover:text-[#a43b31]">
            WithAI
          </Link>
          <span className="text-xs tracking-[0.16em] text-[#625e55] uppercase">
            Privacy & AI Disclosure
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
            <PrivacyPolicyContent />
          </div>
        </section>
      </div>
    </main>
  );
}
