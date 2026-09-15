# WithAI Game Sessions

This context models single-player social-deduction game sessions in which one guest plays alongside independent AI participants. It establishes the shared vocabulary for the game platform and its first Mafia ruleset.

## Participants and information

**Participant**:
A human player or an AI agent occupying one seat in a game session.
_Avoid_: Player (when the human specifically is meant), bot

**Human Player**:
The guest-controlled Participant in a game session.
_Avoid_: User, gamer

**Agent**:
An AI-controlled Participant with an independent private context and decision process.
_Avoid_: Bot, NPC

**Persona**:
A randomly allocated, stable set of behavioral traits and conversational tendencies that guides an Agent's decisions within one Game Session. It is independent of the Agent's Role and Allegiance.
_Avoid_: Prompt, character sheet

**Agent Memory**:
An Agent-only, structured summary of its observations, hypotheses, commitments, and action rationales within an in-progress Game Session. It never contains raw model reasoning and is deleted when that Game Session completes or is abandoned.
_Avoid_: Chain of thought, chat history

**Personal Snapshot**:
The authorized current game view from which one Agent forms a decision: its Persona, Agent Memory, Public Information, and its own Private Information.
_Avoid_: Prompt context, full game state

**Private Information**:
Information visible only to the Participant it belongs to, including that Participant's Role, private reasoning, and active Vote Choice.
_Avoid_: Secret (when referring to a role itself)

**Public Information**:
Information visible to Participants during a Game Session, including public chat messages, game phase, living Participants, and announced outcomes. It never includes an in-progress Vote Choice.
_Avoid_: Shared state

**Allegiance Reveal**:
The public announcement after an elimination that identifies the eliminated Participant as Mafia or Citizen without disclosing any more specific Role.
_Avoid_: Role reveal

## Game sessions

**Game Session**:
One complete playthrough of a selected game with a fixed set of Participants and rules.
_Avoid_: Room, match

**Completed Game Session**:
A Game Session whose Phase is completed. Its Human Player may read its outcome and completed records for 24 hours after completion, but may not take further actions; the retention period does not extend when it is read.
_Avoid_: Archived game, finished room

**Abandoned Game Session**:
An in-progress Game Session whose Reconnect Lease has expired. It cannot be reconnected to or receive further actions, and it does not prevent its Human Player from creating a new Game Session.
_Avoid_: Timed-out session, disconnected session

**Reconnect Lease**:
The Human Player's right to restore an interrupted live subscription, valid only until the latest expiry among successful live-subscription heartbeats plus the reconnect grace duration. An expired Reconnect Lease abandons the in-progress Game Session and cannot be renewed. When a Human Player has concurrent subscriptions, an older heartbeat must not shorten the lease established by a newer heartbeat.
_Avoid_: Connection timeout, session lock

**Game Module**:
The ruleset-owned definition of one selectable game, including its state, permitted actions, information disclosures, resolution, and presentation.
_Avoid_: Mode, game type

**Role**:
A rules-defined private identity that gives a Participant allegiance and permitted actions.
_Avoid_: Class, character

**Allegiance**:
The side whose victory condition a Role pursues.
_Avoid_: Team, faction

**Phase**:
A rules-defined period of a Game Session that determines which actions and public information are available.
_Avoid_: Turn (unless referring to one Participant's action opportunity)

**Discussion Time Adjustment**:
A living Human Player's change of the Discussion Phase's remaining duration by a fixed amount. Each accepted adjustment is recorded as Public Information, is applied to the Discussion deadline, and may cause the Phase to resolve immediately. An Eliminated Human Player cannot make a Discussion Time Adjustment.
_Avoid_: Pause, skip

**Day**:
The public Phase comprising timed discussion, nomination, final defence, and the resulting elimination decision.
_Avoid_: Round

**Night**:
The private Phase in which Mafia maintain one shared Mafia Night Target and eligible special Roles choose their private actions.
_Avoid_: Round

**Public Chat**:
The ordered conversation visible to all living Participants during a Game Session.
_Avoid_: Group chat, chat room

**Mafia Night Chat**:
The ordered private conversation among Mafia Participants in a Game Session, structurally equivalent to Public Chat but restricted to the Mafia. Living Mafia may read it at all times and send messages during Night, while Eliminated Mafia may only read it.
_Avoid_: Secret chat, Mafia channel

**Mafia Night Target**:
A living Participant selected by the Mafia for the Night's Mafia action, including a Mafia Participant when friendly fire or self-sacrifice is strategic. The most recently submitted valid choice is the shared target.
_Avoid_: Kill target, victim

**Speech Decision**:
An Agent's private decision to respond or remain silent after a Public Chat event.
_Avoid_: Auto-reply

**Final Defence**:
The nominated Participant's time-limited public defence during the Day, before the elimination decision is resolved.
_Avoid_: Last words

**Agent Final Defence**:
The required opening public statement made by an Agent who is the Nominee during a Final Defence.
_Avoid_: Auto-reply

**Scheduled Agent Action**:
An Agent action whose payload has been decided or is required, is durably pending, and is consumed at most once before its Phase changes. Its scheduled time determines whether it belongs to that Phase even when durable recovery occurs later. A Mafia Night Chat statement also records its originating Night identity and is discarded if that Night is no longer current. It includes delayed and reactive Public Chat or Mafia Night Chat statements, Final Defence statements, Mafia Night Target fallback, and required Phase-entry actions. It resumes only for an in-progress Game Session after durable recovery; an authorized read may trigger recovery but never consumes it itself.
_Avoid_: Timer, callback, background job

**Nomination**:
The Day vote in which each living Participant chooses one living Participant for Final Defence. A unique highest total produces a Nominee; a tie or no submission produces no Nominee.
_Avoid_: Accusation, primary vote

**Nominee**:
The Participant selected by a resolved Nomination to give a Final Defence and receive a Verdict.
_Avoid_: Defendant, accused

**Verdict**:
The Day vote to eliminate or spare the Nominee. Elimination requires a strict majority of living Participants; otherwise the Nominee remains in the Game Session.
_Avoid_: Execution vote, final vote

**Vote Choice**:
A Participant's selected Nomination target or Verdict. Its connection to the selecting Participant is Private Information until the Game Session is completed.
_Avoid_: Ballot, selection

**Aggregate Vote Tally**:
The publicly announced count for each available Vote Choice after a Nomination or Verdict resolves. It never identifies which Participant selected a choice.
_Avoid_: Vote reveal, ballot status

**Vote Amendment**:
The replacement of a Participant's Vote Choice during its active Phase. Only the latest submitted Vote Choice is counted when the Phase resolves.
_Avoid_: Revote

**Vote Record**:
The complete list of Vote Choices from resolved Nominations and Verdicts. It becomes Public Information only when the Game Session is completed.
_Avoid_: Audit log, vote history

**Night Action Record**:
The completed-only record of each Night's resolved Mafia target and each eligible Doctor's and Police's submitted target or lack of action. It does not disclose a Police's learned Allegiance.
_Avoid_: Night vote, night history

**Eliminated Participant**:
A Participant no longer eligible to take game actions. An Eliminated Participant remains a spectator of Public Information and announced outcomes.
_Avoid_: Dead player, observer

**Guest Play Allowance**:
The daily number of Game Sessions a non-authenticated Human Player may create.
_Avoid_: Rate limit, quota

**Creation Idempotency Key**:
A guest-scoped client key that identifies one request to create or reuse a Game Session. For 24 hours from its first use, the same key and request resolves to the same live or completed Game Session, including when that session was already active at the key's first use. If that Game Session is no longer retained, the key returns `session-not-found`, irrespective of request payload.
_Avoid_: Request ID, creation token

## Mafia ruleset

**Mafia**:
The initial hostile Allegiance, whose members know the identities and Roles of their fellow Mafia and win when they equal or outnumber all non-Mafia living Participants.
_Avoid_: Werewolf

**Citizen**:
The initial non-Mafia Allegiance, which wins when no Mafia remain alive.
_Avoid_: Town, villager

**Police**:
A Citizen Role that may privately learn a selected Participant's Allegiance during an eligible night phase.
_Avoid_: Detective, cop

**Doctor**:
A Citizen Role that may protect a selected Participant from the Mafia's eligible night action.
_Avoid_: Medic, healer
