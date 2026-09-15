import { ApiPropertyOptional } from '@nestjs/swagger';
import { mafiaGameConfig } from '@repo/mafia/config';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'The Human Player display name.', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  humanName?: string;

  @ApiPropertyOptional({ enum: ['ko', 'en'], default: 'ko' })
  @IsOptional()
  @IsIn(['ko', 'en'])
  outputLanguage?: 'ko' | 'en';
}
