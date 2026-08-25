import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateMafiaSessionDto {
  @ApiPropertyOptional({
    minimum: 5,
    maximum: 10,
    default: 5,
    description: 'The total number of Participants, including the Human Player.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10)
  participantCount?: number;
}
