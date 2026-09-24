import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import type { CreateVerdictRequest } from '../contracts.js';

export class CreateVerdictDto implements CreateVerdictRequest {
  @ApiProperty({ enum: ['eliminate', 'spare'] })
  @IsIn(['eliminate', 'spare'])
  vote!: 'eliminate' | 'spare';
}
