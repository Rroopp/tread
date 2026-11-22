import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DataEncryptionService } from '../customers/data-encryption.service';

@Injectable()
export class EmailOutboxService {
  constructor(private readonly encryption: DataEncryptionService) {}

  async enqueueInvitation(client: PoolClient, institutionId: string, recipient: string, invitationUrl: string): Promise<void> {
    const encrypted = this.encryption.encrypt(JSON.stringify({ invitationUrl }));
    await client.query(
      `INSERT INTO email_outbox
        (institution_id, recipient_email, template, payload_key_id, payload_ciphertext, payload_iv, payload_auth_tag)
       VALUES ($1, $2, 'INSTITUTION_INVITATION', $3, $4, $5, $6)`,
      [institutionId, recipient, encrypted.keyId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );
  }

  decryptPayload(row: { payload_key_id: string; payload_ciphertext: string; payload_iv: string; payload_auth_tag: string }) {
    const plaintext = this.encryption.decrypt({
      keyId: row.payload_key_id, ciphertext: row.payload_ciphertext,
      iv: row.payload_iv, authTag: row.payload_auth_tag,
    });
    return JSON.parse(plaintext) as { invitationUrl: string };
  }
}
