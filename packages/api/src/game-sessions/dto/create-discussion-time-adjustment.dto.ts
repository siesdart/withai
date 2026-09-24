import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn } from 'class-validator';

import type { CreateDiscussionTimeAdjustmentRequest } from '../contracts.js';

export class CreateDiscussionTimeAdjustmentDto implements CreateDiscussionTimeAdjustmentRequest {
  @ApiProperty({
    description: 'Seconds to add to or remove from the Discussion deadline.',
    enum: [10, -10],
    example: 10,
  })
  @IsIn([10, -10])
  adjustmentSeconds!: 10 | -10;

  @ApiProperty({
    description:
      'The Discussion deadline displayed when the Human Player requested the adjustment.',
    format: 'date-time',
  })
  @IsDateString()
  expectedDeadline!: string;
}
