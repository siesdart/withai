import { Skeleton } from '@repo/ui/components/skeleton';

export function ControlRoomLoading() {
  return (
    <main className="min-h-dvh bg-[#e9e3d6] px-4 py-5 sm:px-8" aria-label="Starting Game Session">
      <div className="mx-auto max-w-7xl border-b-2 border-[#22221e] pb-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-8 w-72" />
      </div>
      <div className="mx-auto mt-6 grid max-w-7xl gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </main>
  );
}
