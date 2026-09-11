import { ApiPropertyOptional } from '@nestjs/swagger';
import { mafiaGameConfig } from '@repo/mafia/config';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateMafiaSessionDto {
  @ApiPropertyOptional({
    minimum: mafiaGameConfig.minParticipantCount,
    maximum: mafiaGameConfig.maxParticipantCount,
    default: mafiaGameConfig.defaultParticipantCount,
    description: 'The total number of Participants, including the Human Player.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(mafiaGameConfig.minParticipantCount)
  @Max(mafiaGameConfig.maxParticipantCount)
  participantCount?: number;
}
