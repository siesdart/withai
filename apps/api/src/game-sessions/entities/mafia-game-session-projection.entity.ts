import { ApiProperty } from '@nestjs/swagger';
import type {
  MafiaGameProjection,
  MafiaPersonalInformation,
  MafiaPublicChatMessage,
  MafiaPublicInformation,
  MafiaPublicOutcome,
  MafiaPublicVoteStatus,
  MafiaCompletedVoteRecord,
  MafiaPublicTimelineItem,
} from '@repo/mafia';

export class MafiaParticipantEntity {
  @ApiProperty({ example: 'participant-1' })
  id!: string;

  @ApiProperty({ example: 'You' })
  name!: string;

  @ApiProperty({ example: true })
  alive!: boolean;
}

export class MafiaPublicInformationEntity implements MafiaPublicInformation {
  @ApiProperty({ example: 1 })
  dayNumber!: number;

  @ApiProperty({ enum: ['day-discussion', 'nomination', 'final-defence', 'verdict', 'completed'] })
  phase!: MafiaPublicInformation['phase'];

  @ApiProperty({ format: 'date-time' })
  phaseDeadline!: string;

  @ApiProperty({ type: () => MafiaParticipantEntity, isArray: true })
  participants!: ReadonlyArray<MafiaParticipantEntity>;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        participantId: { type: 'string' },
        content: { type: 'string' },
      },
    },
  })
  chat!: ReadonlyArray<MafiaPublicChatMessage>;

  @ApiProperty({ nullable: true, example: 'participant-2' })
  nominatedParticipantId!: string | undefined;

  @ApiProperty({ nullable: true, type: Object })
  voteStatus!: MafiaPublicVoteStatus | undefined;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  outcomes!: ReadonlyArray<MafiaPublicOutcome>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  timeline!: ReadonlyArray<MafiaPublicTimelineItem>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  completedVoteRecords!: ReadonlyArray<MafiaCompletedVoteRecord>;
}

export class MafiaPersonalInformationEntity implements MafiaPersonalInformation {
  @ApiProperty({ example: 'participant-1' })
  participantId!: string;

  @ApiProperty({ enum: ['Mafia', 'Detective', 'Doctor', 'Citizen'] })
  role!: MafiaPersonalInformation['role'];

  @ApiProperty({ enum: ['Mafia', 'Citizen'] })
  allegiance!: MafiaPersonalInformation['allegiance'];

  @ApiProperty({ nullable: true, type: Object })
  vote!: MafiaPersonalInformation['vote'];
}

export class MafiaGameSessionProjectionEntity implements MafiaGameProjection {
  @ApiProperty({ example: 1 })
  eventId!: number;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ type: () => MafiaPublicInformationEntity })
  public!: MafiaPublicInformationEntity;

  @ApiProperty({ type: () => MafiaPersonalInformationEntity })
  personal!: MafiaPersonalInformationEntity;
}
