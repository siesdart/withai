import { Bubble, BubbleContent } from '@repo/ui/components/bubble';
// oxlint-disable react-perf/jsx-no-new-function-as-prop -- user-intent handlers bind the rendered participant or vote selection.
import { Button } from '@repo/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@repo/ui/components/field';
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
import { Textarea } from '@repo/ui/components/textarea';
import { RadioIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';

import type { MafiaGameProjection } from '../api/api';
import type { useDayAction } from '../hooks/use-day-action';
import type { UsePublicSpeechResult } from '../hooks/use-public-speech';
import { GameRecordMarker } from './game-record-marker';
import { VoteStatus } from './vote-status';

type PublicDiscussionPanelProps = {
  publicInformation: MafiaGameProjection['public'];
  currentParticipantId: string;
  currentParticipantAlive: boolean;
  isReconnecting: boolean;
  isPhaseExpired: boolean;
  personalVote: MafiaGameProjection['personal']['vote'];
  publicSpeech: UsePublicSpeechResult;
  dayAction: ReturnType<typeof useDayAction>;
};

export function PublicDiscussionPanel({
  publicInformation,
  currentParticipantId,
  currentParticipantAlive,
  isReconnecting,
  isPhaseExpired,
  personalVote,
  publicSpeech,
  dayAction,
}: PublicDiscussionPanelProps) {
  const [finalDefence, setFinalDefence] = useState('');
  const participantNames = new Map(
    publicInformation.participants.map((participant) => [participant.id, participant.name]),
  );
  const nominatedParticipant = publicInformation.participants.find(
    (participant) => participant.id === publicInformation.nominatedParticipantId,
  );
  const isActionDisabled = dayAction.isPending || isPhaseExpired || !currentParticipantAlive;

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
      <Separator />
      {publicInformation.voteStatus ? (
        <div className="shrink-0 px-3 sm:px-5">
          <VoteStatus
            participants={publicInformation.participants}
            voteStatus={publicInformation.voteStatus}
            currentParticipantId={currentParticipantId}
          />
        </div>
      ) : null}
      {publicInformation.phase === 'day-discussion' ? (
        <form
          className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
          onSubmit={publicSpeech.submit}
        >
          <FieldGroup>
            <Field
              data-invalid={Boolean(publicSpeech.error)}
              data-disabled={
                publicSpeech.isPending ||
                publicSpeech.isThrottled ||
                !currentParticipantAlive ||
                isPhaseExpired
              }
            >
              <FieldLabel htmlFor="public-speech">Your public statement</FieldLabel>
              <Textarea
                id="public-speech"
                aria-invalid={Boolean(publicSpeech.error)}
                disabled={
                  publicSpeech.isPending ||
                  publicSpeech.isThrottled ||
                  !currentParticipantAlive ||
                  isPhaseExpired
                }
                maxLength={500}
                name="public-speech"
                onChange={publicSpeech.onContentChange}
                placeholder="Share your read with the table…"
                value={publicSpeech.content}
              />
              {publicSpeech.error ? <FieldError>{publicSpeech.error}</FieldError> : null}
              <FieldDescription>Living participants can see this immediately.</FieldDescription>
              <div className="flex justify-end">
                <Button
                  disabled={
                    publicSpeech.isPending ||
                    publicSpeech.isThrottled ||
                    !publicSpeech.content.trim() ||
                    !currentParticipantAlive ||
                    isPhaseExpired
                  }
                  type="submit"
                >
                  <SendIcon data-icon="inline-end" />
                  {publicSpeech.isPending
                    ? 'Sending'
                    : publicSpeech.isThrottled
                      ? `Wait ${publicSpeech.retryAfterSeconds ?? 1}s`
                      : 'Speak publicly'}
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </form>
      ) : null}
      {publicInformation.phase === 'nomination' ? (
        <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-5">
          <div>
            <h3 className="text-base font-medium">Choose a nominee</h3>
            <p className="mt-1 text-sm text-[#625e55]">
              {personalVote?.phase === 'nomination'
                ? `Your current nomination is ${participantNames.get(personalVote.targetParticipantId) ?? 'recorded'}. You can change it until the deadline.`
                : 'Nominate one living participant for final defence. You can change your choice until the deadline.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {publicInformation.participants
              .filter((participant) => participant.alive)
              .map((participant) => (
                <Button
                  key={participant.id}
                  disabled={isActionDisabled}
                  onClick={() =>
                    dayAction.submit({ type: 'nomination', targetParticipantId: participant.id })
                  }
                  type="button"
                  variant={
                    personalVote?.phase === 'nomination' &&
                    personalVote.targetParticipantId === participant.id
                      ? 'default'
                      : 'outline'
                  }
                >
                  {personalVote?.phase === 'nomination' &&
                  personalVote.targetParticipantId === participant.id
                    ? `Nominated: ${participant.name}`
                    : `Nominate ${participant.name}`}
                </Button>
              ))}
          </div>
        </div>
      ) : null}
      {publicInformation.phase === 'final-defence' ? (
        <div className="shrink-0 p-3 sm:p-5">
          <h3 className="text-base font-medium">Final defence</h3>
          <p className="mt-1 text-sm text-[#625e55]">
            {nominatedParticipant
              ? `${nominatedParticipant.name} is nominated and has the floor.`
              : 'The nominated participant is preparing a final defence.'}
          </p>
          {publicInformation.nominatedParticipantId === currentParticipantId ? (
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (finalDefence.trim()) {
                  dayAction.submit({ type: 'final-defence', content: finalDefence });
                }
              }}
            >
              <FieldLabel htmlFor="final-defence">Your final defence</FieldLabel>
              <Textarea
                id="final-defence"
                disabled={isActionDisabled}
                maxLength={500}
                onChange={(event) => setFinalDefence(event.target.value)}
                value={finalDefence}
              />
              <Button disabled={isActionDisabled || !finalDefence.trim()} type="submit">
                Deliver final defence
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {publicInformation.phase === 'verdict' ? (
        <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-5">
          <div>
            <h3 className="text-base font-medium">
              Verdict for {nominatedParticipant?.name ?? 'the nominee'}
            </h3>
            <p className="mt-1 text-sm text-[#625e55]">
              {personalVote?.phase === 'verdict'
                ? `Your current verdict is ${personalVote.vote}. You can change it until the deadline.`
                : 'Choose whether to eliminate or spare the nominated participant.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={isActionDisabled}
              onClick={() => dayAction.submit({ type: 'verdict', vote: 'eliminate' })}
              type="button"
            >
              {personalVote?.phase === 'verdict' && personalVote.vote === 'eliminate'
                ? 'Eliminate (your vote)'
                : 'Eliminate'}
            </Button>
            <Button
              disabled={isActionDisabled}
              onClick={() => dayAction.submit({ type: 'verdict', vote: 'spare' })}
              type="button"
              variant="outline"
            >
              {personalVote?.phase === 'verdict' && personalVote.vote === 'spare'
                ? 'Spare (your vote)'
                : 'Spare'}
            </Button>
          </div>
        </div>
      ) : null}
      {publicInformation.phase === 'completed' ? (
        <div className="shrink-0 p-3 text-sm text-[#625e55] sm:p-5">
          You are now observing the completed game. The full vote record is available below.
        </div>
      ) : null}
      {!currentParticipantAlive && publicInformation.phase !== 'completed' ? (
        <div className="shrink-0 border-t border-[#22221e]/25 p-3 text-sm text-[#625e55] sm:p-5">
          You are out of the game. You can continue to observe each phase and its results.
        </div>
      ) : null}
    </section>
  );
}
