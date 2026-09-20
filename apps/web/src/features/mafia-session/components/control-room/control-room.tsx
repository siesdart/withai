import { getAliveParticipantCounts } from '@repo/mafia/client';
import { UsersIcon } from 'lucide-react';

import { useGameAction } from '../../hooks/actions/use-game-action';
import { useGameSessionSnapshot } from '../../hooks/sync/use-game-session-snapshot';
import { useGameSessionSubscription } from '../../hooks/sync/use-game-session-subscription';
import { useDeadlineCountdown } from '../../hooks/ui/use-deadline-countdown';
import { ParticipantList } from '../game-information/participant-list';
import { PublicDiscussionPanel } from '../public-table/public-discussion-panel';
import { createPhaseInteraction } from './phase-interaction';

export function ControlRoom() {
  const { snapshot } = useGameSessionSnapshot();
  const { isReconnecting } = useGameSessionSubscription();
  const gameAction = useGameAction();
  const deadline = useDeadlineCountdown(snapshot.public.phaseDeadline);

  const aliveParticipantCounts = getAliveParticipantCounts(
    snapshot.public.participants,
    snapshot.personal.knownRoles,
  );
  const { panel, participantSelection } = createPhaseInteraction({
    snapshot,
    isPhaseExpired: deadline.isExpired,
    gameAction,
  });

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#e9e3d6] px-4 py-3 text-[#22221e] sm:px-8 sm:py-5">
      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-5 lg:py-6">
        <PublicDiscussionPanel
          currentParticipantId={snapshot.personal.participantId}
          isReconnecting={isReconnecting}
          deadline={deadline}
          knownRoles={snapshot.personal.knownRoles}
          publicInformation={snapshot.public}
          phasePanel={panel}
          timeline={snapshot.timeline}
        />

        <aside
          className="flex flex-col gap-2 border border-[#22221e]/45 bg-[#f4efe7] px-3 pt-3 pb-2 lg:min-h-0 lg:overflow-y-auto"
          aria-labelledby="participants-heading"
        >
          <div className="flex shrink-0">
            <h2
              id="participants-heading"
              className="flex items-center gap-2 text-xs tracking-[0.16em] text-[#625e55] uppercase"
            >
              <UsersIcon aria-hidden="true" />
              Mafia {aliveParticipantCounts.mafia} : Citizen {aliveParticipantCounts.citizen}
            </h2>
            <span className="mr-2 text-xs tracking-normal text-[#625e55] normal-case">alive</span>
          </div>
          <ParticipantList
            participants={snapshot.public.participants}
            currentParticipantId={snapshot.personal.participantId}
            knownRoles={snapshot.personal.knownRoles}
            selection={participantSelection}
            isCompleted={snapshot.public.phase === 'completed'}
          />
        </aside>
      </div>
    </main>
  );
}
