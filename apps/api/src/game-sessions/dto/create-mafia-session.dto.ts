import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMafiaSessionDto {
  @ApiPropertyOptional({
    minimum: 5,
    maximum: 10,
    default: 5,
    description: 'The total number of Participants, including the Human Player.',
  })
  participantCount?: number;
}
