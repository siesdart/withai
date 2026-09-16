import { ApiProperty } from '@nestjs/swagger';

export class GuestPlayAllowanceEntity {
  @ApiProperty({ example: 9, minimum: 0 })
  remaining!: number;

  @ApiProperty({ example: 10, minimum: 1 })
  limit!: number;

  @ApiProperty({ format: 'date-time' })
  resetsAt!: string;
}
