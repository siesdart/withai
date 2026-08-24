/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- throwaway prototype actions intentionally surface a local interaction result. */

import {
  CheckIcon,
  CircleDotIcon,
  EyeOffIcon,
  MessageCircleIcon,
  ShieldIcon,
  TimerIcon,
  VoteIcon,
} from 'lucide-react';

import alleyImage from '@/assets/mafia-prototype-alley.png';

export type PrototypeVariantProps = {
  onAction: (message: string) => void;
};

const participants = [
  { name: 'Mina', note: 'Questioning Joon', active: true },
  { name: 'Joon', note: 'Nominated', active: true },
  { name: 'Sora', note: 'Awaiting response', active: true },
  { name: 'You', note: 'Your seat', active: true },
  { name: 'Hana', note: 'Eliminated · Citizen', active: false },
];

const messages = [
  ['Mina', 'Joon changed his story after the first vote.'],
  ['Sora', 'That could be panic, not evidence.'],
  ['Joon', 'I voted for Hana because I was wrong.'],
];

export function ControlRoomVariant({ onAction }: PrototypeVariantProps) {
  return (
    <div className="min-h-screen bg-[#e9e3d6] px-4 py-5 text-[#22221e] sm:px-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b-2 border-[#22221e] pb-5">
        <div>
          <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
          <h1 className="mt-1 text-2xl font-semibold">Day 2 · Public discussion</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#625e55]">
          <TimerIcon aria-hidden="true" className="size-4" />
          <span>01:42 remaining</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 py-6 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="border border-[#22221e]/45 bg-[#f4efe7] p-4">
          <p className="text-xs tracking-[0.18em] text-[#625e55] uppercase">Living participants</p>
          <ul className="mt-4 flex flex-col gap-1">
            {participants.map((participant) => (
              <li
                key={participant.name}
                className={`flex items-center justify-between px-2 py-2.5 ${participant.active ? 'bg-[#ded6c8]' : 'opacity-40'}`}
              >
                <span>{participant.name}</span>
                <span className="text-xs text-[#625e55]">
                  {participant.active ? 'alive' : 'out'}
                </span>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 border border-[#22221e]/45 bg-[#f4efe7]">
          <div className="border-b border-[#22221e]/25 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs tracking-[0.18em] text-[#625e55] uppercase">Public chat</p>
                <p className="mt-1 text-sm text-[#625e55]">
                  Everyone still alive can read and speak here.
                </p>
              </div>
              <span className="border border-[#22221e]/45 px-2 py-1 text-xs text-[#625e55]">
                Agents reply naturally
              </span>
            </div>
          </div>
          <div className="flex min-h-[22rem] flex-col justify-end gap-4 p-5">
            {messages.map(([name, message], index) => (
              <article
                key={name}
                className={index === 1 ? 'ml-8 border-l-2 border-[#a43b31] pl-3' : ''}
              >
                <p className="text-sm font-semibold">{name}</p>
                <p className="mt-1 max-w-[58ch] text-[#625e55]">{message}</p>
              </article>
            ))}
            <div className="flex items-center gap-2 text-sm text-[#625e55]">
              <span className="flex gap-1" aria-label="Mina is deciding whether to speak">
                <i className="size-1.5 animate-pulse rounded-full bg-[#d8a954]" />
                <i className="size-1.5 animate-pulse rounded-full bg-[#d8a954] [animation-delay:150ms]" />
                <i className="size-1.5 animate-pulse rounded-full bg-[#d8a954] [animation-delay:300ms]" />
              </span>
              Mina is considering a reply
            </div>
          </div>
          <div className="flex gap-2 border-t border-[#22221e]/25 p-4">
            <button
              type="button"
              onClick={() =>
                onAction('Your public message is queued for the next prototype state.')
              }
              className="flex-1 border border-[#22221e]/45 px-3 py-3 text-left text-sm text-[#625e55] transition hover:border-[#a43b31] hover:text-[#22221e]"
            >
              Say something to everyone…
            </button>
            <button
              type="button"
              onClick={() =>
                onAction('Vote panel opened. Your vote stays private until the phase resolves.')
              }
              className="bg-[#22221e] px-4 py-3 text-sm font-semibold text-[#e9e3d6] active:translate-y-px"
            >
              Vote
            </button>
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <section className="border-2 border-[#a43b31] bg-[#f4efe7] p-4">
            <p className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#a43b31] uppercase">
              <CircleDotIcon aria-hidden="true" className="size-3.5" /> Your decision
            </p>
            <p className="mt-3 text-lg font-semibold">Nominate Joon?</p>
            <p className="mt-2 text-sm text-[#625e55]">Visible only to you until votes resolve.</p>
            <button
              type="button"
              onClick={() =>
                onAction(
                  'Joon selected as your nominee. This is private until the server resolves the vote.',
                )
              }
              className="mt-4 w-full bg-[#a43b31] px-3 py-2.5 text-sm font-semibold text-[#f4efe7] active:translate-y-px"
            >
              Select Joon
            </button>
          </section>
          <section className="border border-[#22221e]/45 bg-[#f4efe7] p-4">
            <p className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase">
              <ShieldIcon aria-hidden="true" className="size-3.5" /> Connection
            </p>
            <p className="mt-2 text-sm text-[#625e55]">
              If you disconnect, your seat waits 60 seconds before it is abandoned.
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}

export function StorylineVariant({ onAction }: PrototypeVariantProps) {
  const phases = ['Discussion', 'Nomination', 'Final defence', 'Resolve', 'Night'];

  return (
    <div className="min-h-screen bg-[#e9e3d6] px-4 py-6 text-[#22221e] sm:px-8">
      <main className="mx-auto max-w-6xl">
        <header className="grid gap-5 border-b-2 border-[#22221e] pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-xs tracking-[0.24em] uppercase">Mafia session / one human seat</p>
            <h1 className="mt-3 max-w-[28ch] text-4xl leading-none font-semibold tracking-tight sm:text-6xl">
              The town has 1 minute, 42 seconds to make its case.
            </h1>
          </div>
          <p className="max-w-[22ch] text-sm leading-6">
            One screen tells you what the group can see, what only you can do, and what will happen
            next.
          </p>
        </header>

        <nav aria-label="Game phase" className="mt-7 grid grid-cols-5 border-y border-[#22221e]">
          {phases.map((phase, index) => (
            <div
              key={phase}
              className={`px-2 py-3 text-center text-xs sm:text-sm ${index === 0 ? 'bg-[#22221e] text-[#e9e3d6]' : ''}`}
            >
              <span className="mr-1 font-mono text-[10px] opacity-65">0{index + 1}</span>
              {phase}
            </div>
          ))}
        </nav>

        <section className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase">What everyone sees</p>
            <div className="mt-4 border-l-2 border-[#a43b31] pl-5">
              {messages.map(([name, message], index) => (
                <article key={name} className="border-b border-[#22221e]/25 py-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="font-semibold">{name}</h2>
                    <span className="font-mono text-xs">00:{31 + index * 12}</span>
                  </div>
                  <p className="mt-2 text-lg leading-7">{message}</p>
                </article>
              ))}
            </div>
            <p className="mt-5 flex items-center gap-2 text-sm">
              <MessageCircleIcon aria-hidden="true" className="size-4" /> Mina is weighing whether
              to answer. Agents are not instant responders.
            </p>
          </div>

          <aside className="bg-[#22221e] p-6 text-[#e9e3d6]">
            <p className="flex items-center gap-2 text-xs tracking-[0.2em] text-[#d8a954] uppercase">
              <EyeOffIcon aria-hidden="true" className="size-4" /> Only you see this
            </p>
            <h2 className="mt-6 text-3xl leading-tight font-semibold">Choose who you suspect.</h2>
            <p className="mt-4 text-[#d7cfbf]">
              Your choice is private now. The server reveals only the resolved public outcome.
            </p>
            <div className="mt-8 flex flex-col gap-2">
              {participants
                .filter((participant) => participant.active && participant.name !== 'You')
                .map((participant) => (
                  <button
                    key={participant.name}
                    type="button"
                    onClick={() => onAction(`Your private suspicion is now ${participant.name}.`)}
                    className="flex items-center justify-between border border-[#e9e3d6]/35 px-4 py-3 text-left transition hover:border-[#d8a954] hover:text-[#d8a954] active:translate-y-px"
                  >
                    <span>{participant.name}</span>
                    <span className="text-xs text-[#c7bfae]">{participant.note}</span>
                  </button>
                ))}
            </div>
            <p className="mt-8 border-t border-[#e9e3d6]/25 pt-4 text-sm text-[#c7bfae]">
              Reconnect grace: your private view is restored for 60 seconds.
            </p>
          </aside>
        </section>
      </main>
    </div>
  );
}

export function StageVariant({ onAction }: PrototypeVariantProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0e0f] px-4 py-5 text-white sm:px-8">
      <img
        src={alleyImage}
        alt="Rainy alley at night"
        className="absolute inset-0 h-full w-full object-cover opacity-45 grayscale"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,7,7,.96),rgba(6,7,7,.55),rgba(6,7,7,.92))]" />
      <main className="relative mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-7xl grid-rows-[auto_1fr_auto]">
        <header className="flex items-center justify-between border-b border-white/25 pb-5">
          <p className="text-sm tracking-[0.22em] text-white/75 uppercase">
            Mafia / Night falls in 01:42
          </p>
          <button
            type="button"
            onClick={() =>
              onAction(
                'Connection status inspected: your session is protected by a 60-second grace period.',
              )
            }
            className="text-sm text-white/80 underline decoration-white/35 underline-offset-4"
          >
            Connection secure
          </button>
        </header>

        <section className="grid items-center gap-12 py-12 lg:grid-cols-[1fr_19rem]">
          <div>
            <p className="text-sm tracking-[0.22em] text-[#e7c47b] uppercase">
              Final defence is next
            </p>
            <h1 className="mt-4 max-w-[14ch] text-5xl leading-[0.93] font-semibold tracking-tight sm:text-7xl">
              Do you let the room decide?
            </h1>
            <p className="mt-7 max-w-[52ch] text-lg leading-7 text-white/75">
              The moment is public; your vote is not. When the discussion ends, Joon gets one final
              defence before the outcome is announced.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onAction('You will vote to eliminate Joon when voting opens.')}
                className="bg-[#e7c47b] px-5 py-3 text-sm font-bold text-[#201d16] active:translate-y-px"
              >
                Vote Joon
              </button>
              <button
                type="button"
                onClick={() => onAction('Public-message composer opened.')}
                className="border border-white/40 px-5 py-3 text-sm font-semibold text-white active:translate-y-px"
              >
                Speak publicly
              </button>
            </div>
          </div>
          <aside className="border border-white/30 bg-black/35 p-5 backdrop-blur-sm">
            <p className="flex items-center gap-2 text-xs tracking-[0.18em] text-white/70 uppercase">
              <VoteIcon aria-hidden="true" className="size-4" /> The room
            </p>
            <ul className="mt-4 flex flex-col gap-3">
              {participants.map((participant) => (
                <li
                  key={participant.name}
                  className="flex items-center justify-between border-b border-white/15 pb-3"
                >
                  <span className={participant.active ? '' : 'text-white/35 line-through'}>
                    {participant.name}
                  </span>
                  <span className="text-xs text-white/55">{participant.note}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <footer className="grid gap-3 border-t border-white/25 pt-5 text-sm text-white/70 md:grid-cols-3">
          <p>
            <CheckIcon aria-hidden="true" className="mr-2 inline size-4 text-[#e7c47b]" />
            Your role never appears in public.
          </p>
          <p>
            <TimerIcon aria-hidden="true" className="mr-2 inline size-4 text-[#e7c47b]" />
            The server controls every deadline.
          </p>
          <p>
            <EyeOffIcon aria-hidden="true" className="mr-2 inline size-4 text-[#e7c47b]" />
            Night actions are a separate private scene.
          </p>
        </footer>
      </main>
    </div>
  );
}
