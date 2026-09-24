import { ApiProperty } from '@nestjs/swagger';

import type { GuestPlayAllowance } from './contracts.js';

export class GuestPlayAllowanceEntity implements GuestPlayAllowance {
  @ApiProperty({ example: 9, minimum: 0 })
  remaining!: number;

  @ApiProperty({ example: 10, minimum: 1 })
  limit!: number;

  @ApiProperty({ format: 'date-time' })
  resetsAt!: string;
}
