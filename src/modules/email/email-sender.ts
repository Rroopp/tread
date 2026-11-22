export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailMessage {
  recipient: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
