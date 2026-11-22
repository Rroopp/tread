import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, EmailSender } from './email-sender';

@Injectable()
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(ConsoleEmailSender.name);

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(JSON.stringify({ channel: 'development-email', ...message }));
  }
}
