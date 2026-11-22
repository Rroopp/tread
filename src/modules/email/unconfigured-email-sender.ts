import { ServiceUnavailableException } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender';

export class UnconfiguredEmailSender implements EmailSender {
  async send(_message: EmailMessage): Promise<void> {
    throw new ServiceUnavailableException('Production email provider is not configured');
  }
}
