import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMafiaChatDto {
  @ApiProperty({
    description: 'A statement shared with Mafia Participants during Night.',
    example: 'Let us focus on the quietest participant.',
    minLength: 1,
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;
}
