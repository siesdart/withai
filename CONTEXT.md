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
A stable set of behavioral traits and conversational tendencies that guides an Agent's decisions within a Game Session.
_Avoid_: Prompt, character sheet

**Private Information**:
Information visible only to the Participant it belongs to, including that Participant's role and private reasoning.
_Avoid_: Secret (when referring to a role itself)

**Public Information**:
Information every living Participant may use, including public chat messages, game phase, living Participants, and announced outcomes.
_Avoid_: Shared state

**Allegiance Reveal**:
The public announcement after an elimination that identifies the eliminated Participant as Mafia or Citizen without disclosing any more specific Role.
_Avoid_: Role reveal

## Game sessions

**Game Session**:
One complete playthrough of a selected game with a fixed set of Participants and rules.
_Avoid_: Room, match

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

**Day**:
The public Phase comprising timed discussion, nomination, final defence, and the resulting elimination decision.
_Avoid_: Round

**Night**:
The private Phase in which Mafia coordinate a target and eligible special Roles choose their private actions.
_Avoid_: Round

**Public Chat**:
The ordered conversation visible to all living Participants during a Game Session.
_Avoid_: Group chat, chat room

**Speech Decision**:
An Agent's private decision to respond or remain silent after a Public Chat event.
_Avoid_: Auto-reply

**Final Defence**:
The nominated Participant's final public statement before the elimination decision is resolved.
_Avoid_: Last words

**Guest Play Allowance**:
The daily number of Game Sessions a non-authenticated Human Player may create.
_Avoid_: Rate limit, quota

## Mafia ruleset

**Mafia**:
The initial hostile Allegiance, whose members know the identities and Roles of their fellow Mafia and win when they equal or outnumber all non-Mafia living Participants.
_Avoid_: Werewolf

**Citizen**:
The initial non-Mafia Allegiance, which wins when no Mafia remain alive.
_Avoid_: Town, villager

**Detective**:
A Citizen Role that may privately learn a selected Participant's Allegiance during an eligible night phase.
_Avoid_: Police, cop

**Doctor**:
A Citizen Role that may protect a selected Participant from the Mafia's eligible night action.
_Avoid_: Medic, healer
