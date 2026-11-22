import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { WebhooksDashboardController } from './webhooks-dashboard.controller';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';

@Module({
  imports: [JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('AUTH_ACCESS_TOKEN_SECRET') }),
  })],
  controllers: [WebhooksController, WebhooksDashboardController],
  providers: [WebhooksService, WebhookDeliveryWorker, JwtAuthGuard, InstitutionRolesGuard],
})
export class WebhooksModule {}
