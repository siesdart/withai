import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { EyeOffIcon, TimerIcon, UsersIcon } from 'lucide-react';

import { useDayAction } from '../hooks/use-day-action';
import { useDeadlineCountdown } from '../hooks/use-deadline-countdown';
import { useGameSessionSnapshot } from '../hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '../hooks/use-game-session-subscription';
import { usePublicSpeech } from '../hooks/use-public-speech';
import { ParticipantList } from './participant-list';
import { PersonalInformation } from './personal-information';
import { PublicDiscussionPanel } from './public-discussion-panel';

export function ControlRoom({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);
  const publicSpeech = usePublicSpeech(sessionId);
  const dayAction = useDayAction(sessionId);
  const deadline = useDeadlineCountdown(snapshot.public.phaseDeadline);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#e9e3d6] px-4 py-3 text-[#22221e] sm:px-8 sm:py-5">
      <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between border-b-2 border-[#22221e] pb-3 sm:pb-5">
        <div className="min-w-0">
          <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Day 1 / Public discussion</h1>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5 text-xs text-[#625e55] sm:gap-2 sm:text-sm">
          <TimerIcon aria-hidden="true" className="size-4" />
          <span className="whitespace-nowrap">Deadline in {deadline}</span>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 py-3 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)_18rem] lg:gap-5 lg:py-6">
        <Accordion className="border border-[#22221e]/45 bg-[#f4efe7] px-3 lg:hidden">
          <AccordionItem value="participants">
            <AccordionTrigger className="py-3 no-underline hover:no-underline">
              <span className="flex min-w-0 items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase">
                <UsersIcon aria-hidden="true" /> Living participants
              </span>
              <span className="mr-2 text-xs tracking-normal text-[#625e55] normal-case">
                {snapshot.public.participants.filter((participant) => participant.alive).length}{' '}
                alive
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <ParticipantList participants={snapshot.public.participants} />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="private-information">
            <AccordionTrigger className="py-3 no-underline hover:no-underline">
              <span className="flex min-w-0 items-center gap-2 text-xs tracking-[0.18em] text-[#a43b31] uppercase">
                <EyeOffIcon aria-hidden="true" /> Your private information
              </span>
              <span className="mr-2 text-xs tracking-normal text-[#625e55] normal-case">
                {snapshot.personal.role}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <PersonalInformation personal={snapshot.personal} compact />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <section
          className="hidden border border-[#22221e]/45 bg-[#f4efe7] p-4 lg:block lg:min-h-0 lg:overflow-y-auto"
          aria-labelledby="participants-heading"
        >
          <h2
            id="participants-heading"
            className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
          >
            <UsersIcon aria-hidden="true" /> Living participants
          </h2>
          <ParticipantList participants={snapshot.public.participants} />
        </section>

        <PublicDiscussionPanel
          currentParticipantId={snapshot.personal.participantId}
          isReconnecting={isReconnecting}
          publicInformation={snapshot.public}
          publicSpeech={publicSpeech}
          dayAction={dayAction}
        />

        <aside
          className="hidden border-2 border-[#a43b31] bg-[#f4efe7] p-4 lg:block lg:min-h-0 lg:overflow-y-auto"
          aria-labelledby="personal-information-heading"
        >
          <h2
            id="personal-information-heading"
            className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#a43b31] uppercase"
          >
            <EyeOffIcon aria-hidden="true" /> Your private information
          </h2>
          <PersonalInformation personal={snapshot.personal} />
        </aside>
      </div>
    </main>
  );
}
