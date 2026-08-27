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
import { Separator } from '@repo/ui/components/separator';
import { RadioIcon } from 'lucide-react';

import type { MafiaGameProjection } from '../api/api';
import { GameRecordMarker } from './game-record-marker';
import { VoteStatus } from './vote-status';

type PublicDiscussionPanelProps = {
  publicInformation: MafiaGameProjection['public'];
  currentParticipantId: string;
  currentParticipantAlive: boolean;
  isReconnecting: boolean;
  controls: React.ReactNode;
};

export function PublicDiscussionPanel({
  publicInformation,
  currentParticipantId,
  currentParticipantAlive,
  isReconnecting,
  controls,
}: PublicDiscussionPanelProps) {
  const participantNames = new Map(
    publicInformation.participants.map((participant) => [participant.id, participant.name]),
  );
  const shouldShowPlayerControls =
    currentParticipantAlive && publicInformation.phase !== 'completed';

  return (
    <section
      className="flex min-h-0 flex-1 flex-col border border-[#22221e]/45 bg-[#f4efe7] lg:min-h-0"
      aria-labelledby="public-information-heading"
    >
      <div className="shrink-0 border-b border-[#22221e]/25 p-3 sm:p-5">
        <h2
          id="public-information-heading"
          className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
        >
          <RadioIcon aria-hidden="true" className="size-4" /> Public table
        </h2>
        {isReconnecting ? (
          <span aria-live="polite" className="sr-only">
            Reconnecting live updates…
          </span>
        ) : null}
      </div>
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport className="p-3 text-sm sm:p-5">
            <MessageScrollerContent>
              {publicInformation.timeline.length === 0 ? (
                <p className="mt-auto text-[#625e55]">
                  The table is waiting for the first public statement.
                </p>
              ) : (
                <MessageGroup>
                  {publicInformation.timeline.map((item) => {
                    if (item.type === 'record') {
                      return (
                        <MessageScrollerItem key={item.id} messageId={item.id}>
                          <GameRecordMarker
                            completedVoteRecords={publicInformation.completedVoteRecords}
                            outcome={item.outcome}
                            participantNames={participantNames}
                          />
                        </MessageScrollerItem>
                      );
                    }
                    const isCurrentParticipant =
                      item.message.participantId === currentParticipantId;
                    return (
                      <MessageScrollerItem key={item.id} messageId={item.id}>
                        <Message align={isCurrentParticipant ? 'end' : 'start'}>
                          <MessageContent>
                            <MessageHeader>
                              {participantNames.get(item.message.participantId) ?? 'Participant'}
                            </MessageHeader>
                            <Bubble
                              align={isCurrentParticipant ? 'end' : 'start'}
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
      {shouldShowPlayerControls ? <Separator /> : null}
      {shouldShowPlayerControls && publicInformation.voteStatus ? (
        <div className="shrink-0 px-3 sm:px-5">
          <VoteStatus
            participants={publicInformation.participants}
            voteStatus={publicInformation.voteStatus}
            currentParticipantId={currentParticipantId}
          />
        </div>
      ) : null}
      {controls}
    </section>
  );
}
