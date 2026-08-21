import { CreateLinkDto } from './create-link.dto';
import { PartialType } from '@nestjs/mapped-types';

export class UpdateLinkDto extends PartialType(CreateLinkDto) {}
