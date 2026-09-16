/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- the completed-game link clears transient session storage at the click boundary. */

import { type MafiaGameProjection, mafiaRoleCountsFor } from '@repo/mafia/client';
import { UsersIcon } from 'lucide-react';
import { filter, map } from 'remeda';

import { useGameAction } from '../../hooks/actions/use-game-action';
import { useGameSessionSnapshot } from '../../hooks/sync/use-game-session-snapshot';
import { useGameSessionSubscription } from '../../hooks/sync/use-game-session-subscription';
import { useDeadlineCountdown } from '../../hooks/ui/use-deadline-countdown';
import { useGameSessionStore } from '../../store/game-session';
import { ParticipantList } from '../game-information/participant-list';
import { PublicDiscussionPanel } from '../public-table/public-discussion-panel';
import { createPhaseInteraction } from './phase-interaction';

export function ControlRoom({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);
  const gameAction = useGameAction(sessionId);
  const deadline = useDeadlineCountdown(snapshot.public.phaseDeadline);

  const { mafiaCount, citizenCount } = getParticipantCounts(
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
      <header
        className="relative mx-auto w-full max-w-7xl min-w-0 shrink-0 border-b-2 border-[#22221e] pb-3 sm:pb-5"
        aria-labelledby="phase-title"
      >
        <h1
          id="phase-title"
          className="text-2xl leading-none font-bold tracking-[-0.035em] sm:text-3xl"
        >
          WithAI / Mafia
        </h1>
        {snapshot.public.phase === 'completed' ? (
          <a
            href="/"
            className="absolute right-0 bottom-3 inline-flex h-8 items-center border border-[#22221e] px-2.5 text-xs font-medium hover:bg-[#22221e] hover:text-[#f4efe7]"
            onClick={() => useGameSessionStore.getState().clearSession()}
          >
            게임 목록으로
          </a>
        ) : null}
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-3 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-5 lg:py-6">
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
          className="border border-[#22221e]/45 bg-[#f4efe7] p-4 lg:min-h-0 lg:overflow-y-auto"
          aria-labelledby="participants-heading"
        >
          <div className="flex shrink-0">
            <h2
              id="participants-heading"
              className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
            >
              <UsersIcon aria-hidden="true" /> Participants
            </h2>
            <span className="mr-2 text-xs tracking-normal text-[#625e55] normal-case">
              {filter(snapshot.public.participants, (participant) => participant.alive).length}{' '}
              alive
            </span>
          </div>
          <span className="mt-2 block text-center text-sm text-[#625e55]">
            Mafia {mafiaCount} : Citizen {citizenCount}
          </span>
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

function getParticipantCounts(
  participants: MafiaGameProjection['public']['participants'],
  knownRoles: MafiaGameProjection['personal']['knownRoles'],
) {
  const knownRolesMap = new Map(
    map(knownRoles, ({ participantId, role }) => [participantId, role] as const),
  );
  const aliveParticipantCount = filter(participants, ({ alive }) => alive).length;
  const initialMafiaCount = mafiaRoleCountsFor(participants.length).Mafia;
  const deadMafiaCount = filter(
    participants,
    (participant) => !participant.alive && knownRolesMap.get(participant.id) === 'Mafia',
  ).length;
  const mafiaCount = Math.max(initialMafiaCount - deadMafiaCount, 0);

  return {
    mafiaCount,
    citizenCount: Math.max(aliveParticipantCount - mafiaCount, 0),
  };
}
