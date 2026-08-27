/* oxlint-disable react-perf/jsx-no-jsx-as-prop, react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- session-owned actions are adapted into a semantic child contract at this composition boundary. */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
import { EyeOffIcon, UsersIcon } from 'lucide-react';

import { useDayAction } from '../hooks/use-day-action';
import { useDeadlineCountdown } from '../hooks/use-deadline-countdown';
import { useGameSessionSnapshot } from '../hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '../hooks/use-game-session-subscription';
import { usePublicSpeech } from '../hooks/use-public-speech';
import { GamePhaseStatus } from './game-phase-status';
import { ParticipantList } from './participant-list';
import { PersonalInformation } from './personal-information';
import { PhaseActionPanel } from './phase-action-panel';
import { PublicDiscussionPanel } from './public-discussion-panel';

export function ControlRoom({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);
  const publicSpeech = usePublicSpeech(sessionId);
  const dayAction = useDayAction(sessionId);
  const deadline = useDeadlineCountdown(snapshot.public.phaseDeadline);
  const currentParticipantAlive = snapshot.public.participants.some(
    (participant) => participant.id === snapshot.personal.participantId && participant.alive,
  );
  const revealedAllegiances = new Map(
    snapshot.public.timeline.flatMap((item) =>
      item.type === 'record' && item.outcome.type === 'allegiance-reveal'
        ? [[item.outcome.participantId, item.outcome.allegiance] as const]
        : [],
    ),
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#e9e3d6] px-4 py-3 text-[#22221e] sm:px-8 sm:py-5">
      <header className="mx-auto w-full max-w-7xl shrink-0">
        <GamePhaseStatus
          dayNumber={snapshot.public.dayNumber}
          phase={snapshot.public.phase}
          deadline={deadline}
        />
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
              <ParticipantList
                participants={snapshot.public.participants}
                currentParticipantId={snapshot.personal.participantId}
                revealedAllegiances={revealedAllegiances}
              />
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
          <ParticipantList
            participants={snapshot.public.participants}
            currentParticipantId={snapshot.personal.participantId}
            revealedAllegiances={revealedAllegiances}
          />
        </section>

        <PublicDiscussionPanel
          currentParticipantId={snapshot.personal.participantId}
          currentParticipantAlive={currentParticipantAlive}
          isReconnecting={isReconnecting}
          publicInformation={snapshot.public}
          controls={
            <PhaseActionPanel
              currentParticipantId={snapshot.personal.participantId}
              currentParticipantAlive={currentParticipantAlive}
              isPhaseExpired={deadline.isExpired}
              isSubmittingAction={dayAction.isPending}
              onNominate={(targetParticipantId) =>
                dayAction.submit({ type: 'nomination', targetParticipantId })
              }
              onSubmitFinalDefence={(content) =>
                dayAction.submit({ type: 'final-defence', content })
              }
              onSubmitVerdict={(vote) => dayAction.submit({ type: 'verdict', vote })}
              personalVote={snapshot.personal.vote}
              publicInformation={snapshot.public}
              speech={{
                content: publicSpeech.content,
                error: publicSpeech.error,
                isPending: publicSpeech.isPending,
                isThrottled: publicSpeech.isThrottled,
                onContentChange: publicSpeech.onContentChange,
                retryAfterSeconds: publicSpeech.retryAfterSeconds,
                submitSpeech: publicSpeech.submit,
              }}
            />
          }
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
