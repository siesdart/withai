import { Skeleton } from '@repo/ui/components/skeleton';
import { createPortal } from 'react-dom';

export function MafiaStartDialogSkeleton() {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <output
      className="fixed inset-0 z-50"
      aria-label="마피아 게임 시작 창을 불러오고 있어요."
      aria-busy="true"
    >
      <div className="absolute inset-0 bg-[#22221e]/45" aria-hidden="true" />
      <div className="fixed inset-0 flex items-end justify-center p-3 sm:items-center">
        <div
          className="w-full max-w-lg border-2 border-[#22221e] bg-[#f4efe7] p-5 shadow-2xl sm:p-7"
          aria-hidden="true"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-52 bg-[#ded6c8]" />
            <Skeleton className="h-4 w-full max-w-80 bg-[#ded6c8]" />
          </div>

          <div className="mt-5 flex h-12 items-center border-y border-[#22221e]/20 px-1">
            <Skeleton className="h-4 w-28 bg-[#ded6c8]" />
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24 bg-[#ded6c8]" />
              <Skeleton className="h-10 w-full bg-[#ded6c8]" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16 bg-[#ded6c8]" />
              <Skeleton className="h-10 w-full bg-[#ded6c8]" />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 border-y border-[#22221e]/20 py-4">
            <Skeleton className="h-4 w-full max-w-64 bg-[#ded6c8]" />
            <Skeleton className="h-4 w-40 bg-[#ded6c8]" />
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <Skeleton className="h-3 w-full bg-[#ded6c8]" />
            <Skeleton className="h-3 w-4/5 bg-[#ded6c8]" />
            <Skeleton className="h-3 w-2/3 bg-[#ded6c8]" />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Skeleton className="h-9 w-16 bg-[#ded6c8]" />
            <Skeleton className="h-9 w-24 bg-[#ded6c8]" />
          </div>
        </div>
      </div>
    </output>,
    document.body,
  );
}
