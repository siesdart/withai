import { ApiProperty } from '@nestjs/swagger';
import type { MafiaPhase } from '@repo/mafia';
import { IsDateString, IsIn } from 'class-validator';

type ActiveMafiaPhase = Exclude<MafiaPhase, 'completed'>;

export class CreatePhaseTimeAdjustmentDto {
  @ApiProperty({
    description: 'Seconds to add to or remove from the active Phase deadline.',
    enum: [10, -10],
    example: 10,
  })
  @IsIn([10, -10])
  adjustmentSeconds!: 10 | -10;

  @ApiProperty({
    description: 'The active Phase displayed when the Human Player requested the adjustment.',
    enum: ['day-discussion', 'nomination', 'final-defence', 'verdict'],
    example: 'day-discussion',
  })
  @IsIn(['day-discussion', 'nomination', 'final-defence', 'verdict'])
  expectedPhase!: ActiveMafiaPhase;

  @ApiProperty({
    description: 'The Phase deadline displayed when the Human Player requested the adjustment.',
    format: 'date-time',
  })
  @IsDateString()
  expectedPhaseDeadline!: string;
}
