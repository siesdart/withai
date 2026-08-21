import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { Module } from '@nestjs/common';

@Module({ controllers: [LinksController], providers: [LinksService] })
export class LinksModule {}
