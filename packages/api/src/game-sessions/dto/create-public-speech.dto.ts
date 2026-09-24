import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import type { CreatePublicSpeechRequest } from '../contracts.js';

export class CreatePublicSpeechDto implements CreatePublicSpeechRequest {
  @ApiProperty({
    description: 'The statement a Human Player shares with every living Participant.',
    example: 'I think we should hear from everyone before voting.',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;
}
