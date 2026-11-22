import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { DataEncryptionService } from '../customers/data-encryption.service';
import { ConsoleEmailSender } from './console-email-sender';
import { EmailDeliveryWorker } from './email-delivery.worker';
import { EmailOutboxService } from './email-outbox.service';
import { EMAIL_SENDER } from './email-sender';
import { UnconfiguredEmailSender } from './unconfigured-email-sender';

@Module({
  imports: [DatabaseModule],
  providers: [
    DataEncryptionService,
    EmailOutboxService,
    ConsoleEmailSender,
    EmailDeliveryWorker,
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService, ConsoleEmailSender],
      useFactory: (config: ConfigService, consoleSender: ConsoleEmailSender) =>
        config.get<string>('NODE_ENV') === 'production' ? new UnconfiguredEmailSender() : consoleSender,
    },
  ],
  exports: [EmailOutboxService],
})
export class EmailModule {}
