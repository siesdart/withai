import { ApiProperty } from '@nestjs/swagger';
import type {
  MafiaGameProjection,
  MafiaPersonalInformation,
  MafiaPublicInformation,
  MafiaCompletedRecords,
  MafiaPersonalTimelineItem,
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

  @ApiProperty({
    enum: ['discussion', 'nomination', 'final-defence', 'verdict', 'night', 'completed'],
  })
  phase!: MafiaPublicInformation['phase'];

  @ApiProperty({ format: 'date-time' })
  phaseDeadline!: string;

  @ApiProperty({ type: () => MafiaParticipantEntity, isArray: true })
  participants!: ReadonlyArray<MafiaParticipantEntity>;

  @ApiProperty({ nullable: true, example: 'participant-2' })
  nominatedParticipantId!: string | undefined;

  @ApiProperty({ type: Object })
  completedRecords!: MafiaCompletedRecords;
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

  @ApiProperty({ nullable: true, type: Object })
  nightAction!: MafiaPersonalInformation['nightAction'];

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        participantId: { type: 'string', example: 'participant-2' },
        role: { enum: ['Mafia', 'Detective', 'Doctor', 'Citizen'] },
      },
    },
  })
  knownRoles!: MafiaPersonalInformation['knownRoles'];
}

export class MafiaGameSessionProjectionEntity implements MafiaGameProjection {
  @ApiProperty({ example: 1 })
  eventId!: number;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  timeline!: ReadonlyArray<MafiaPersonalTimelineItem>;

  @ApiProperty({ type: () => MafiaPublicInformationEntity })
  public!: MafiaPublicInformationEntity;

  @ApiProperty({ type: () => MafiaPersonalInformationEntity })
  personal!: MafiaPersonalInformationEntity;
}
