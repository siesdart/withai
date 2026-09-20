import { Skeleton } from '@repo/ui/components/skeleton';
import { map } from 'remeda';

const participantSkeletons = Array.from({ length: 8 });

function DiscussionPanelLoading() {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col border border-[#22221e]/45 bg-[#f4efe7]"
      aria-label="Loading public discussion"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#ded7c9] bg-[#f8f4eb] px-3 py-4 sm:px-5">
        <Skeleton className="size-3.5 rounded-full bg-[#ded6c8]" />
        <Skeleton className="h-3.5 w-28 bg-[#ded6c8]" />
        <Skeleton className="ml-auto h-3.5 w-24 bg-[#ded6c8]" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-3 py-4 sm:px-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24 bg-[#ded6c8]" />
            <Skeleton className="h-10 w-3/5 bg-[#ded6c8]" />
            <Skeleton className="h-3 w-20 self-end bg-[#ded6c8]" />
            <Skeleton className="h-10 w-2/5 self-end bg-[#ded6c8]" />
          </div>
          <div className="flex flex-col gap-2 border-y border-[#ded7c9] py-4">
            <Skeleton className="h-3 w-32 bg-[#ded6c8]" />
            <Skeleton className="h-3 w-4/5 bg-[#ded6c8]" />
            <Skeleton className="h-3 w-3/5 bg-[#ded6c8]" />
            <Skeleton className="h-10 w-1/2 self-end bg-[#ded6c8]" />
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28 bg-[#ded6c8]" />
            <Skeleton className="h-10 w-1/2 bg-[#ded6c8]" />
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col">
        <div className="flex items-center justify-end gap-1 border-b border-[#22221e]/15 px-3 py-2 sm:px-5">
          <Skeleton className="h-9 w-14 bg-[#ded6c8]" />
          <Skeleton className="h-9 w-14 bg-[#ded6c8]" />
        </div>
        <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 flex-1 bg-[#ded6c8]" />
            <Skeleton className="size-9 bg-[#ded6c8]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ParticipantsLoading() {
  return (
    <aside
      className="border border-[#22221e]/45 bg-[#f4efe7] p-4 lg:min-h-0 lg:overflow-y-auto"
      aria-label="Loading participants"
    >
      <div className="flex shrink-0 items-center gap-2">
        <Skeleton className="size-4 rounded-full bg-[#ded6c8]" />
        <Skeleton className="h-3.5 w-24 bg-[#ded6c8]" />
        <Skeleton className="ml-auto h-3.5 w-12 bg-[#ded6c8]" />
      </div>
      <ul className="mt-4 grid grid-cols-4 justify-center gap-1 lg:grid-cols-1 lg:justify-normal">
        {map(participantSkeletons, (_, index) => (
          <li className="aspect-square min-w-0 lg:aspect-auto" key={index}>
            <Skeleton className="h-full min-h-0 w-full bg-[#ded6c8] lg:min-h-12" />
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function ControlRoomLoading() {
  return (
    <main
      className="flex h-dvh flex-col overflow-hidden bg-[#e9e3d6] px-4 py-3 text-[#22221e] sm:px-8 sm:py-5"
      aria-label="Starting Game Session"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-5 lg:py-6">
        <DiscussionPanelLoading />
        <ParticipantsLoading />
      </div>
    </main>
  );
}
