import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class CreateVerdictDto {
  @ApiProperty({ enum: ['eliminate', 'spare'] })
  @IsIn(['eliminate', 'spare'])
  vote!: 'eliminate' | 'spare';
}
