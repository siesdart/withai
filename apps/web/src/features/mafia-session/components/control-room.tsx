import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@repo/ui/components/accordion';
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
import { ParticipantList } from './participant-list';
import { PersonalInformation } from './personal-information';

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
    <main className="flex h-dvh flex-col overflow-hidden bg-[#e9e3d6] px-4 py-3 text-[#22221e] sm:px-8 sm:py-5">
      <header className="mx-auto flex w-full max-w-7xl shrink-0 items-center justify-between border-b-2 border-[#22221e] pb-3 sm:pb-5">
        <div className="min-w-0">
          <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">Day 1 / Public discussion</h1>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5 text-xs text-[#625e55] sm:gap-2 sm:text-sm">
          <TimerIcon aria-hidden="true" className="size-4" />
          <span className="whitespace-nowrap">Deadline in {deadline}</span>
          {isReconnecting ? (
            <span aria-live="polite" className="sr-only">
              Reconnecting live updates…
            </span>
          ) : null}
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
              The server has opened discussion. Every living Participant has the same public view.
            </p>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollContainerRef}
              className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-sm sm:p-5"
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
        </section>

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
