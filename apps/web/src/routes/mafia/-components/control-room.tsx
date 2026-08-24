import { EyeOffIcon, RadioIcon, TimerIcon, UsersIcon } from 'lucide-react';

import type { GameSessionProjection } from '@/lib/game-session-api';

import { useDeadlineCountdown } from '../-hooks/use-deadline-countdown';

export function ControlRoom({ projection }: { projection: GameSessionProjection }) {
  const deadline = useDeadlineCountdown(projection.public.phaseDeadline);

  return (
    <main className="min-h-dvh bg-[#e9e3d6] px-4 py-5 text-[#22221e] sm:px-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b-2 border-[#22221e] pb-5">
        <div>
          <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
          <h1 className="mt-1 text-2xl font-semibold">Day 1 / Public discussion</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#625e55]">
          <TimerIcon aria-hidden="true" />
          <span>Deadline in {deadline}</span>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 py-6 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <section
          className="border border-[#22221e]/45 bg-[#f4efe7] p-4"
          aria-labelledby="participants-heading"
        >
          <h2
            id="participants-heading"
            className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
          >
            <UsersIcon aria-hidden="true" /> Living participants
          </h2>
          <ul className="mt-4 flex flex-col gap-1">
            {projection.public.participants.map((participant) => (
              <li
                key={participant.id}
                className="flex items-center justify-between bg-[#ded6c8] px-2 py-2.5"
              >
                <span>{participant.name}</span>
                <span className="text-xs text-[#625e55]">
                  {participant.alive ? 'alive' : 'out'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="border border-[#22221e]/45 bg-[#f4efe7]"
          aria-labelledby="public-information-heading"
        >
          <div className="border-b border-[#22221e]/25 p-5">
            <h2
              id="public-information-heading"
              className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
            >
              <RadioIcon aria-hidden="true" /> Public information
            </h2>
            <p className="mt-2 text-sm text-[#625e55]">
              The server has opened discussion. Every living Participant has the same public view.
            </p>
          </div>
          <div className="flex min-h-72 items-end p-5 text-sm text-[#625e55]">
            Public Chat will appear here as ordered server events arrive.
          </div>
        </section>

        <aside
          className="border-2 border-[#a43b31] bg-[#f4efe7] p-4"
          aria-labelledby="personal-information-heading"
        >
          <h2
            id="personal-information-heading"
            className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#a43b31] uppercase"
          >
            <EyeOffIcon aria-hidden="true" /> Your private information
          </h2>
          <dl className="mt-5 flex flex-col gap-4">
            <div>
              <dt className="text-xs text-[#625e55]">Role</dt>
              <dd className="mt-1 text-xl font-semibold">{projection.personal.role}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#625e55]">Allegiance</dt>
              <dd className="mt-1 text-lg font-semibold">{projection.personal.allegiance}</dd>
            </div>
          </dl>
          <p className="mt-8 text-sm text-[#625e55]">
            Only this browser identity can reopen this Game Session.
          </p>
        </aside>
      </div>
    </main>
  );
}
