import { Bubble, BubbleContent } from '@repo/ui/components/bubble';
// oxlint-disable react-perf/jsx-no-new-function-as-prop -- each handler binds the rendered Participant or vote intent.
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

type PublicDiscussionPanelProps = {
  publicInformation: MafiaGameProjection['public'];
  currentParticipantId: string;
  isReconnecting: boolean;
  publicSpeech: UsePublicSpeechResult;
  dayAction: ReturnType<typeof useDayAction>;
};

export function PublicDiscussionPanel({
  publicInformation,
  currentParticipantId,
  isReconnecting,
  publicSpeech,
  dayAction,
}: PublicDiscussionPanelProps) {
  const [finalDefence, setFinalDefence] = useState('');
  const participantNames = new Map(
    publicInformation.participants.map((participant) => [participant.id, participant.name]),
  );

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
          <RadioIcon aria-hidden="true" /> Public information
        </h2>
        <p className="mt-1.5 text-xs text-[#625e55] sm:mt-2 sm:text-sm">
          The server controls this Phase. Every living Participant has the same public view.
        </p>
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
              {publicInformation.chat.length === 0 ? (
                <p className="mt-auto text-[#625e55]">
                  The table is waiting for the first public statement.
                </p>
              ) : (
                <MessageGroup>
                  {publicInformation.chat.map((message) => {
                    const isCurrentParticipant = message.participantId === currentParticipantId;

                    return (
                      <MessageScrollerItem key={message.id} messageId={message.id}>
                        <Message align={isCurrentParticipant ? 'end' : 'start'}>
                          <MessageContent>
                            <MessageHeader>
                              {participantNames.get(message.participantId) ?? 'Participant'}
                            </MessageHeader>
                            <Bubble
                              align={isCurrentParticipant ? 'end' : 'start'}
                              variant={isCurrentParticipant ? 'tinted' : 'muted'}
                            >
                              <BubbleContent>{message.content}</BubbleContent>
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
      {publicInformation.phase === 'day-discussion' ? (
        <form
          className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
          onSubmit={publicSpeech.submit}
        >
          <FieldGroup>
            <Field
              data-invalid={Boolean(publicSpeech.error)}
              data-disabled={publicSpeech.isPending || publicSpeech.isThrottled}
            >
              <FieldLabel htmlFor="public-speech">Your public statement</FieldLabel>
              <Textarea
                id="public-speech"
                aria-invalid={Boolean(publicSpeech.error)}
                disabled={publicSpeech.isPending || publicSpeech.isThrottled}
                maxLength={500}
                name="public-speech"
                onChange={publicSpeech.onContentChange}
                placeholder="Share your read with the table…"
                value={publicSpeech.content}
              />
              {publicSpeech.error ? <FieldError>{publicSpeech.error}</FieldError> : null}
              <FieldDescription>Living Participants can see this immediately.</FieldDescription>
              <div className="flex justify-end">
                <Button
                  disabled={
                    publicSpeech.isPending ||
                    publicSpeech.isThrottled ||
                    !publicSpeech.content.trim()
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
        <div className="space-y-2 p-3 sm:p-5">
          <p className="text-sm text-[#625e55]">
            Nominate one living Participant for Final Defence.
          </p>
          <div className="flex flex-wrap gap-2">
            {publicInformation.participants
              .filter((participant) => participant.alive)
              .map((participant) => (
                <Button
                  key={participant.id}
                  disabled={dayAction.isPending}
                  onClick={() =>
                    dayAction.submit({ type: 'nomination', targetParticipantId: participant.id })
                  }
                  type="button"
                >
                  Nominate {participant.name}
                </Button>
              ))}
          </div>
        </div>
      ) : null}
      {publicInformation.phase === 'final-defence' &&
      publicInformation.nominatedParticipantId === currentParticipantId ? (
        <form
          className="space-y-2 p-3 sm:p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (finalDefence.trim())
              dayAction.submit({ type: 'final-defence', content: finalDefence });
          }}
        >
          <FieldLabel htmlFor="final-defence">Your Final Defence</FieldLabel>
          <Textarea
            id="final-defence"
            maxLength={500}
            onChange={(event) => setFinalDefence(event.target.value)}
            value={finalDefence}
          />
          <Button disabled={dayAction.isPending || !finalDefence.trim()} type="submit">
            Deliver Final Defence
          </Button>
        </form>
      ) : null}
      {publicInformation.phase === 'verdict' ? (
        <div className="flex gap-2 p-3 sm:p-5">
          <Button
            disabled={dayAction.isPending}
            onClick={() => dayAction.submit({ type: 'verdict', vote: 'eliminate' })}
            type="button"
          >
            Eliminate
          </Button>
          <Button
            disabled={dayAction.isPending}
            onClick={() => dayAction.submit({ type: 'verdict', vote: 'spare' })}
            type="button"
            variant="outline"
          >
            Spare
          </Button>
        </div>
      ) : null}
    </section>
  );
}
