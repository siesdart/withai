import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CreatePhaseTimeAdjustmentDto {
  @ApiProperty({
    description: 'Seconds to add to or remove from the active Phase deadline.',
    enum: [10, -10],
    example: 10,
  })
  @IsIn([10, -10])
  adjustmentSeconds!: 10 | -10;
}
