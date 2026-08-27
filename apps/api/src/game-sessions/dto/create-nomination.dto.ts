import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNominationDto {
  @ApiProperty({
    description: 'The living Participant nominated for Final Defence.',
    example: 'participant-2',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  targetParticipantId!: string;
}
