import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import type { CreateNominationRequest } from '../contracts.js';

export class CreateNominationDto implements CreateNominationRequest {
  @ApiProperty({
    description: 'The living Participant nominated for Final Defence.',
    example: 'participant-2',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  targetParticipantId!: string;
}
