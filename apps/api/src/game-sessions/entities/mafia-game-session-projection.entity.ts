import { ApiProperty } from '@nestjs/swagger';
import type {
  MafiaGameProjection,
  MafiaPersonalInformation,
  MafiaPublicInformation,
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
  @ApiProperty({ example: 'day-discussion' })
  phase!: 'day-discussion';

  @ApiProperty({ format: 'date-time' })
  phaseDeadline!: string;

  @ApiProperty({ type: () => MafiaParticipantEntity, isArray: true })
  participants!: ReadonlyArray<MafiaParticipantEntity>;
}

export class MafiaPersonalInformationEntity implements MafiaPersonalInformation {
  @ApiProperty({ example: 'participant-1' })
  participantId!: string;

  @ApiProperty({ enum: ['Mafia', 'Detective', 'Doctor', 'Citizen'] })
  role!: MafiaPersonalInformation['role'];

  @ApiProperty({ enum: ['Mafia', 'Citizen'] })
  allegiance!: MafiaPersonalInformation['allegiance'];
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
