import { Bubble, BubbleContent } from '@repo/ui/components/bubble';
import { Button } from '@repo/ui/components/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@repo/ui/components/field';
import { Message, MessageContent, MessageGroup, MessageHeader } from '@repo/ui/components/message';
import { Separator } from '@repo/ui/components/separator';
import { Textarea } from '@repo/ui/components/textarea';
import { ArrowDownIcon, EyeOffIcon, RadioIcon, SendIcon, TimerIcon, UsersIcon } from 'lucide-react';

import type { MafiaGameProjection } from '../api/api';
import { useDeadlineCountdown } from '../hooks/use-deadline-countdown';
import { usePublicChatAutoScroll } from '../hooks/use-public-chat-auto-scroll';
import type { UsePublicSpeechResult } from '../hooks/use-public-speech';

export function ControlRoom({
  snapshot,
  isReconnecting,
  publicSpeech,
}: {
  snapshot: MafiaGameProjection;
  isReconnecting: boolean;
  publicSpeech: UsePublicSpeechResult;
}) {
  const deadline = useDeadlineCountdown(snapshot.public.phaseDeadline);
  const { scrollContainerRef, scrollToLatest, unreadMessageCount } = usePublicChatAutoScroll(
    snapshot.public.chat.at(-1)?.id,
  );
  const participantNames = new Map(
    snapshot.public.participants.map((participant) => [participant.id, participant.name]),
  );

  return (
    <main className="min-h-dvh bg-[#e9e3d6] px-4 py-5 text-[#22221e] sm:px-8 lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between border-b-2 border-[#22221e] pb-5">
        <div>
          <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
          <h1 className="mt-1 text-2xl font-semibold">Day 1 / Public discussion</h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-[#625e55]">
          <TimerIcon aria-hidden="true" />
          <span>Deadline in {deadline}</span>
          {isReconnecting ? <span aria-live="polite">Reconnecting live updates…</span> : null}
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-7xl gap-5 py-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <section
          className="border border-[#22221e]/45 bg-[#f4efe7] p-4 lg:min-h-0 lg:overflow-y-auto"
          aria-labelledby="participants-heading"
        >
          <h2
            id="participants-heading"
            className="flex items-center gap-2 text-xs tracking-[0.18em] text-[#625e55] uppercase"
          >
            <UsersIcon aria-hidden="true" /> Living participants
          </h2>
          <ul className="mt-4 flex flex-col gap-1">
            {snapshot.public.participants.map((participant) => (
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
          className="flex border border-[#22221e]/45 bg-[#f4efe7] lg:min-h-0 lg:flex-col"
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
          <div className="relative flex min-h-56 flex-col lg:min-h-0 lg:flex-1">
            <div
              ref={scrollContainerRef}
              className="flex min-h-56 flex-col p-5 text-sm lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
            >
              {snapshot.public.chat.length === 0 ? (
                <p className="mt-auto text-[#625e55]">
                  The table is waiting for the first public statement.
                </p>
              ) : (
                <MessageGroup>
                  {snapshot.public.chat.map((message) => (
                    <Message
                      key={message.id}
                      align={
                        message.participantId === snapshot.personal.participantId ? 'end' : 'start'
                      }
                    >
                      <MessageContent>
                        <MessageHeader>
                          {participantNames.get(message.participantId) ?? 'Participant'}
                        </MessageHeader>
                        <Bubble
                          align={
                            message.participantId === snapshot.personal.participantId
                              ? 'end'
                              : 'start'
                          }
                          variant={
                            message.participantId === snapshot.personal.participantId
                              ? 'tinted'
                              : 'muted'
                          }
                        >
                          <BubbleContent>{message.content}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  ))}
                </MessageGroup>
              )}
            </div>
            {unreadMessageCount > 0 ? (
              <Button
                className="absolute bottom-4 left-1/2 -translate-x-1/2 border-[#22221e]/45 bg-[#f4efe7] text-[#22221e] shadow-sm"
                onClick={scrollToLatest}
                size="sm"
                type="button"
                variant="outline"
              >
                <ArrowDownIcon data-icon="inline-start" />
                {unreadMessageCount} new {unreadMessageCount === 1 ? 'message' : 'messages'}
              </Button>
            ) : null}
          </div>
          <Separator />
          <form className="p-5" onSubmit={publicSpeech.submit}>
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
                  onChange={publicSpeech.onContentChange}
                  placeholder="Share your read with the table."
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
        </section>

        <aside
          className="border-2 border-[#a43b31] bg-[#f4efe7] p-4 lg:min-h-0 lg:overflow-y-auto"
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
              <dd className="mt-1 text-xl font-semibold">{snapshot.personal.role}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#625e55]">Allegiance</dt>
              <dd className="mt-1 text-lg font-semibold">{snapshot.personal.allegiance}</dd>
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
