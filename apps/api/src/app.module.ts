import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LinksModule } from './links/links.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [LinksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
