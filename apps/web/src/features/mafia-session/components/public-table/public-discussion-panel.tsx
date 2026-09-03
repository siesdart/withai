import { Bubble, BubbleContent } from '@repo/ui/components/bubble';
import { Message, MessageContent, MessageGroup, MessageHeader } from '@repo/ui/components/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@repo/ui/components/message-scroller';
import { cn } from '@repo/ui/lib/utils';
import { MoonIcon, SunIcon } from 'lucide-react';
import { map, reduce } from 'remeda';

import type { MafiaGameProjection } from '../../api/client';
import type { UseDeadlineCountdownResult } from '../../hooks/ui/use-deadline-countdown';
import type { PhasePanel } from '../control-room/phase-interaction';
import { PhaseActionPanel } from '../phase-actions/phase-action-panel';
import { GamePhaseTimer } from './game-phase-timer';
import { GameRecordMarker } from './game-record-marker';

type PublicDiscussionPanelProps = {
  publicInformation: MafiaGameProjection['public'];
  knownRoles: MafiaGameProjection['personal']['knownRoles'];
  timeline: MafiaGameProjection['timeline'];
  currentParticipantId: string;
  isReconnecting: boolean;
  deadline: UseDeadlineCountdownResult;
  phasePanel: PhasePanel;
};

type TimelineItem = MafiaGameProjection['timeline'][number];
type TimelinePeriod = 'day' | 'night';
type SegmentedTimeline = {
  id: string;
  dayNumber: number;
  items: TimelineItem[];
  period: TimelinePeriod;
};

type KnownRole = MafiaGameProjection['personal']['knownRoles'][number]['role'];

const participantNameClassName = (role: KnownRole | undefined, isNight: boolean) =>
  role
    ? role === 'Mafia'
      ? 'text-[#dc2626]'
      : 'text-[#16a34a]'
    : isNight
      ? 'text-[#d8d7df]'
      : 'text-[#625e55]';

const periodFor = (item: TimelineItem, currentPeriod: TimelinePeriod): TimelinePeriod => {
  if (item.type !== 'record') return currentPeriod;
  if (item.outcome.type === 'day-changed') return 'day';
  if (item.outcome.type !== 'phase-changed') return currentPeriod;
  return item.outcome.phase === 'night' ? 'night' : 'day';
};

const dayNumberFor = (item: TimelineItem, currentDayNumber: number) =>
  item.type === 'record' && 'dayNumber' in item.outcome ? item.outcome.dayNumber : currentDayNumber;

const groupTimelineByPeriod = (timeline: readonly TimelineItem[]): SegmentedTimeline[] =>
  reduce(
    timeline,
    (segments, item) => {
      const previousSegment = segments.at(-1);
      const period = periodFor(item, previousSegment?.period ?? 'night');
      const dayNumber = dayNumberFor(item, previousSegment?.dayNumber ?? 1);

      if (!previousSegment || previousSegment.period !== period) {
        segments.push({ dayNumber, id: item.id, items: [item], period });
        return segments;
      }

      previousSegment.items.push(item);
      return segments;
    },
    [] as SegmentedTimeline[],
  );

export function PublicDiscussionPanel({
  publicInformation,
  knownRoles,
  currentParticipantId,
  isReconnecting,
  deadline,
  phasePanel,
  timeline,
}: PublicDiscussionPanelProps) {
  const participantMap = new Map(
    map(publicInformation.participants, (participant) => [participant.id, participant.name]),
  );
  const knownRolesMap = new Map(
    map(knownRoles, ({ participantId, role }) => [participantId, role] as const),
  );
  const timelineSegments = groupTimelineByPeriod(timeline);
  const currentPeriod = publicInformation.phase === 'night' ? 'night' : 'day';
  const CurrentPeriodIcon = currentPeriod === 'night' ? MoonIcon : SunIcon;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col border border-[#22221e]/45 bg-[#f4efe7] lg:min-h-0"
      aria-labelledby="public-information-heading"
    >
      {isReconnecting ? (
        <span aria-live="polite" className="sr-only">
          Reconnecting live updates…
        </span>
      ) : null}
      <div
        className={cn(
          'flex shrink-0 flex-nowrap items-center gap-1.5 border-b px-3 py-4 text-xs font-medium tracking-[0.16em] uppercase sm:gap-2 sm:px-5',
          currentPeriod === 'night'
            ? 'border-[#565968] bg-[#292b35] text-[#c9cad5] shadow-[0_1px_0_rgb(255_255_255/0.05)]'
            : 'border-[#ded7c9] bg-[#f8f4eb] text-[#766f63]',
        )}
      >
        <CurrentPeriodIcon aria-hidden="true" className="size-3.5" />
        <span className="whitespace-nowrap">
          Day {publicInformation.dayNumber} / {currentPeriod}
        </span>
        <GamePhaseTimer phase={publicInformation.phase} deadline={deadline} />
      </div>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="h-auto! flex-1!">
          <MessageScrollerViewport className="h-auto! flex-1! px-3 py-0 text-sm sm:px-5">
            <MessageScrollerContent className="gap-0">
              {timeline.length === 0 ? (
                <p className="mt-auto text-[#625e55]">
                  The table is waiting for the first public statement.
                </p>
              ) : (
                map(timelineSegments, (segment) => {
                  const isNight = segment.period === 'night';
                  return (
                    <section
                      key={segment.id}
                      aria-label={`Day ${segment.dayNumber} ${segment.period} records`}
                      className={cn(
                        '-mx-3 border-y px-3 py-4 sm:-mx-5 sm:px-5',
                        isNight
                          ? 'border-[#565968] bg-[#292b35] text-[#f7f2e8] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)]'
                          : 'border-[#ded7c9] bg-[#f8f4eb]',
                      )}
                    >
                      <MessageGroup>
                        {map(segment.items, (item) => {
                          if (item.type === 'record') {
                            return (
                              <MessageScrollerItem key={item.id} messageId={item.id}>
                                <GameRecordMarker
                                  completedRecords={publicInformation.completedRecords}
                                  isNight={isNight}
                                  outcome={item.outcome}
                                  participantNames={participantMap}
                                />
                              </MessageScrollerItem>
                            );
                          }
                          if (item.type === 'mafia-chat') {
                            const isCurrentParticipant =
                              item.message.participantId === currentParticipantId;
                            return (
                              <MessageScrollerItem key={item.id} messageId={item.id}>
                                <Message align={isCurrentParticipant ? 'end' : 'start'}>
                                  <MessageContent>
                                    <MessageHeader
                                      className={participantNameClassName(
                                        knownRolesMap.get(item.message.participantId),
                                        isNight,
                                      )}
                                    >
                                      {participantMap.get(item.message.participantId) ?? 'Mafia'}
                                    </MessageHeader>
                                    <Bubble
                                      align={isCurrentParticipant ? 'end' : 'start'}
                                      className={cn(
                                        '**:data-[slot=bubble-content]:border-[#7884a4]! **:data-[slot=bubble-content]:bg-[#4d5874]! **:data-[slot=bubble-content]:text-[#f7f2e8]!',
                                      )}
                                      variant={isCurrentParticipant ? 'tinted' : 'muted'}
                                    >
                                      <BubbleContent>{item.message.content}</BubbleContent>
                                    </Bubble>
                                  </MessageContent>
                                </Message>
                              </MessageScrollerItem>
                            );
                          }
                          const isCurrentParticipant =
                            item.message.participantId === currentParticipantId;
                          return (
                            <MessageScrollerItem key={item.id} messageId={item.id}>
                              <Message align={isCurrentParticipant ? 'end' : 'start'}>
                                <MessageContent>
                                  <MessageHeader
                                    className={participantNameClassName(
                                      knownRolesMap.get(item.message.participantId),
                                      isNight,
                                    )}
                                  >
                                    {participantMap.get(item.message.participantId) ??
                                      'Participant'}
                                  </MessageHeader>
                                  <Bubble
                                    align={isCurrentParticipant ? 'end' : 'start'}
                                    className={cn(
                                      isNight
                                        ? isCurrentParticipant
                                          ? '**:data-[slot=bubble-content]:border-[#7884a4]! **:data-[slot=bubble-content]:bg-[#4d5874]! **:data-[slot=bubble-content]:text-[#f7f2e8]!'
                                          : '**:data-[slot=bubble-content]:border-[#565968]! **:data-[slot=bubble-content]:bg-[#383b47]! **:data-[slot=bubble-content]:text-[#f7f2e8]!'
                                        : isCurrentParticipant
                                          ? '**:data-[slot=bubble-content]:border-[#62594e]! **:data-[slot=bubble-content]:bg-[#393833]! **:data-[slot=bubble-content]:text-[#f8f4eb]! **:data-[slot=bubble-content]:shadow-[0_2px_0_rgb(34_34_30/0.16)]'
                                          : '**:data-[slot=bubble-content]:border-[#b8aa96]! **:data-[slot=bubble-content]:bg-[#fffaf2]! **:data-[slot=bubble-content]:text-[#38332c]! **:data-[slot=bubble-content]:shadow-[0_2px_0_rgb(34_34_30/0.08)]',
                                    )}
                                    variant={isCurrentParticipant ? 'tinted' : 'muted'}
                                  >
                                    <BubbleContent>{item.message.content}</BubbleContent>
                                  </Bubble>
                                </MessageContent>
                              </Message>
                            </MessageScrollerItem>
                          );
                        })}
                      </MessageGroup>
                    </section>
                  );
                })
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton
            className="border-[#22221e]/45 bg-[#f4efe7] text-[#22221e] shadow-sm"
            size="sm"
            variant="outline"
          >
            <span>Scroll to latest messages</span>
          </MessageScrollerButton>
        </MessageScroller>
      </MessageScrollerProvider>
      <PhaseActionPanel panel={phasePanel} />
    </section>
  );
}
