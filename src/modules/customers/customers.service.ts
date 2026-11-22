import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { InstitutionPrincipal, UserPrincipal } from '../identity/api-key.types';
import { CreateBeneficiaryDto, CreateCustomerDto } from './customers.dto';
import { DataEncryptionService, EncryptedValue } from './data-encryption.service';

interface EnvironmentRow { id: string; environment: 'SANDBOX' | 'PRODUCTION' }
type TenantPrincipal = UserPrincipal | InstitutionPrincipal;

@Injectable()
export class CustomersService {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly encryption: DataEncryptionService,
  ) {}

  async listCustomers(principal: TenantPrincipal) {
    const environment = await this.principalEnvironment(principal);
    if (!environment) return { environment: null, customers: [] };
    const result = await this.pool.query(
      `SELECT id, external_reference, customer_type, country_code, status,
        pii_key_id, pii_ciphertext, pii_iv, pii_auth_tag, created_at, updated_at
       FROM institution_customers WHERE institution_id = $1 AND environment_id = $2
       ORDER BY created_at DESC LIMIT 100`, [principal.institutionId, environment.id],
    );
    await this.audit(principal, 'customer.listed', 'institution_customers', null);
    return { environment: environment.environment, customers: result.rows.map((row) => ({
      id: row.id, externalReference: row.external_reference, customerType: row.customer_type,
      countryCode: row.country_code, status: row.status, ...this.decryptContact(row),
      createdAt: row.created_at, updatedAt: row.updated_at,
    })) };
  }

  async createCustomer(principal: TenantPrincipal, input: CreateCustomerDto) {
    const environment = await this.requirePrincipalEnvironment(principal);
    const encrypted = this.encryption.encrypt(JSON.stringify({
      displayName: input.displayName.trim(), email: input.email?.trim().toLowerCase() ?? null,
      phone: input.phone?.trim() ?? null,
    }));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO institution_customers
          (institution_id, environment_id, external_reference, customer_type, country_code,
           status, pii_key_id, pii_ciphertext, pii_iv, pii_auth_tag, created_by)
         SELECT i.id, e.id, $3, $4, $5, 'PENDING_VERIFICATION', $6, $7, $8, $9, $10
         FROM institutions i JOIN institution_environments e ON e.id = $2 AND e.institution_id = i.id
         WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.status = 'ACTIVE' RETURNING id`,
        [principal.institutionId, environment.id, input.externalReference.trim(), input.customerType, input.countryCode,
          encrypted.keyId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, userId(principal)],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new ConflictException('Institution or environment is not active');
      await client.query(
        `INSERT INTO customer_verification_events (customer_id, institution_id, environment_id, provider_code, decision, reason_code)
         VALUES ($1, $2, $3, 'tread_pending', 'PENDING', 'PROVIDER_NOT_CONFIGURED')`,
        [id, principal.institutionId, environment.id],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, actor_credential_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, 'customer.created', 'institution_customer', $4, $5::jsonb)`,
        [principal.institutionId, userId(principal), credentialId(principal), id, JSON.stringify({ externalReference: input.externalReference, customerType: input.customerType, countryCode: input.countryCode })],
      );
      await client.query('COMMIT');
      return { id, externalReference: input.externalReference.trim(), customerType: input.customerType,
        countryCode: input.countryCode, status: 'PENDING_VERIFICATION' as const,
        displayName: input.displayName.trim(), email: input.email?.trim().toLowerCase() ?? null, phone: input.phone?.trim() ?? null,
        environment: environment.environment };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep original error. */ }
      if (isUniqueViolation(error)) throw new ConflictException('Customer reference is already in use');
      throw error;
    } finally { client.release(); }
  }

  async disableCustomer(principal: TenantPrincipal, customerId: string) {
    const environment = await this.requirePrincipalEnvironment(principal);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE institution_customers SET status = 'DISABLED', updated_at = now()
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status <> 'DISABLED' RETURNING id`,
        [customerId, principal.institutionId, environment.id],
      );
      if (!result.rows[0]) throw new NotFoundException('Customer not found or already disabled');
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, actor_credential_id, action, resource_type, resource_id)
         VALUES ($1, $2, $3, 'customer.disabled', 'institution_customer', $4)`,
        [principal.institutionId, userId(principal), credentialId(principal), customerId],
      );
      await client.query('COMMIT');
      return { id: customerId, status: 'DISABLED' };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep original error. */ }
      throw error;
    } finally { client.release(); }
  }

  async listBeneficiaries(principal: TenantPrincipal) {
    const environment = await this.principalEnvironment(principal);
    if (!environment) return { environment: null, beneficiaries: [] };
    const result = await this.pool.query(
      `SELECT b.id, b.external_reference, b.destination_type, b.country_code, b.currency_code,
        b.status, b.masked_destination, b.details_key_id, b.details_ciphertext, b.details_iv, b.details_auth_tag, b.created_at, b.updated_at,
        c.external_reference AS customer_reference
       FROM institution_beneficiaries b LEFT JOIN institution_customers c
         ON c.id = b.customer_id AND c.institution_id = b.institution_id AND c.environment_id = b.environment_id
       WHERE b.institution_id = $1 AND b.environment_id = $2 ORDER BY b.created_at DESC LIMIT 100`,
      [principal.institutionId, environment.id],
    );
    await this.audit(principal, 'beneficiary.listed', 'institution_beneficiaries', null);
    return { environment: environment.environment, beneficiaries: result.rows.map((row) => {
      const encrypted: EncryptedValue = { keyId: row.details_key_id, ciphertext: row.details_ciphertext, iv: row.details_iv, authTag: row.details_auth_tag };
      const details = JSON.parse(this.encryption.decrypt(encrypted)) as { displayName: string };
      return { id: row.id, external_reference: row.external_reference, destination_type: row.destination_type,
        country_code: row.country_code, currency_code: row.currency_code, status: row.status,
        masked_destination: row.masked_destination, customer_reference: row.customer_reference,
        display_name: details.displayName, created_at: row.created_at, updated_at: row.updated_at };
    }) };
  }

  async createBeneficiary(principal: TenantPrincipal, input: CreateBeneficiaryDto) {
    const environment = await this.requirePrincipalEnvironment(principal);
    const destination = this.validateDestination(input.destinationType, input.destinationDetails);
    const asset = await this.pool.query(
      `SELECT 1 FROM currencies WHERE code = $1 AND enabled = true
       UNION ALL SELECT 1 FROM assets WHERE code = $1 AND enabled = true LIMIT 1`, [input.currencyCode],
    );
    if (!asset.rows[0]) throw new ConflictException('Currency or asset is not enabled');
    if (input.customerId) {
      const customer = await this.pool.query(
        `SELECT id FROM institution_customers WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status <> 'DISABLED'`,
        [input.customerId, principal.institutionId, environment.id],
      );
      if (!customer.rows[0]) throw new NotFoundException('Customer not found in the active environment');
    }
    const encrypted = this.encryption.encrypt(JSON.stringify({ displayName: input.displayName.trim(), destination }));
    const maskedDestination = mask(destination.accountNumber ?? destination.iban ?? destination.phoneNumber ?? destination.address ?? 'pending');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO institution_beneficiaries
          (institution_id, environment_id, customer_id, external_reference, destination_type,
           country_code, currency_code, status, details_key_id, details_ciphertext, details_iv,
           details_auth_tag, masked_destination, created_by)
         SELECT i.id, e.id, $3, $4, $5, $6, $7, 'PENDING_VERIFICATION', $8, $9, $10, $11, $12, $13
         FROM institutions i JOIN institution_environments e ON e.id = $2 AND e.institution_id = i.id
         WHERE i.id = $1 AND i.status = 'ACTIVE' AND e.status = 'ACTIVE' RETURNING id`,
        [principal.institutionId, environment.id, input.customerId ?? null, input.externalReference.trim(),
          input.destinationType, input.countryCode, input.currencyCode, encrypted.keyId,
          encrypted.ciphertext, encrypted.iv, encrypted.authTag, maskedDestination, userId(principal)],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new ConflictException('Institution or environment is not active');
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, actor_credential_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, 'beneficiary.created', 'institution_beneficiary', $4, $5::jsonb)`,
        [principal.institutionId, userId(principal), credentialId(principal), id, JSON.stringify({ externalReference: input.externalReference, destinationType: input.destinationType, countryCode: input.countryCode, currencyCode: input.currencyCode })],
      );
      await client.query('COMMIT');
      return { id, externalReference: input.externalReference.trim(), destinationType: input.destinationType,
        countryCode: input.countryCode, currencyCode: input.currencyCode, status: 'PENDING_VERIFICATION' as const,
        displayName: input.displayName.trim(), maskedDestination, environment: environment.environment };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep original error. */ }
      if (isUniqueViolation(error)) throw new ConflictException('Beneficiary reference is already in use');
      throw error;
    } finally { client.release(); }
  }

  async disableBeneficiary(principal: TenantPrincipal, beneficiaryId: string) {
    const environment = await this.requirePrincipalEnvironment(principal);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE institution_beneficiaries SET status = 'DISABLED', updated_at = now()
         WHERE id = $1 AND institution_id = $2 AND environment_id = $3 AND status <> 'DISABLED' RETURNING id`,
        [beneficiaryId, principal.institutionId, environment.id],
      );
      if (!result.rows[0]) throw new NotFoundException('Beneficiary not found or already disabled');
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, actor_credential_id, action, resource_type, resource_id)
         VALUES ($1, $2, $3, 'beneficiary.disabled', 'institution_beneficiary', $4)`,
        [principal.institutionId, userId(principal), credentialId(principal), beneficiaryId],
      );
      await client.query('COMMIT');
      return { id: beneficiaryId, status: 'DISABLED' };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep original error. */ }
      throw error;
    } finally { client.release(); }
  }

  private async activeEnvironment(institutionId: string): Promise<EnvironmentRow | null> {
    const result = await this.pool.query<EnvironmentRow>(
      `SELECT id, environment FROM institution_environments WHERE institution_id = $1 AND status = 'ACTIVE'
       ORDER BY CASE environment WHEN 'SANDBOX' THEN 0 ELSE 1 END LIMIT 1`, [institutionId],
    );
    return result.rows[0] ?? null;
  }

  private async requireActiveEnvironment(institutionId: string): Promise<EnvironmentRow> {
    const environment = await this.activeEnvironment(institutionId);
    if (!environment) throw new ConflictException('No active institution environment is available');
    return environment;
  }

  private async principalEnvironment(principal: TenantPrincipal): Promise<EnvironmentRow | null> {
    if (!('environmentId' in principal)) return this.activeEnvironment(principal.institutionId);
    const result = await this.pool.query<EnvironmentRow>(
      `SELECT id, environment FROM institution_environments WHERE id = $1 AND institution_id = $2 AND status = 'ACTIVE'`,
      [principal.environmentId, principal.institutionId],
    );
    return result.rows[0] ?? null;
  }

  private async requirePrincipalEnvironment(principal: TenantPrincipal): Promise<EnvironmentRow> {
    const environment = await this.principalEnvironment(principal);
    if (!environment) throw new ConflictException('No active institution environment is available');
    return environment;
  }

  private decryptContact(row: Record<string, unknown>) {
    const value = this.encryption.decrypt({ keyId: row.pii_key_id as string, ciphertext: row.pii_ciphertext as string,
      iv: row.pii_iv as string, authTag: row.pii_auth_tag as string });
    return JSON.parse(value) as { displayName: string; email: string | null; phone: string | null };
  }

  private validateDestination(type: CreateBeneficiaryDto['destinationType'], raw: Record<string, unknown>): Record<string, string> {
    const allowed = type === 'BANK' ? ['accountNumber', 'iban', 'bankCode', 'branchCode']
      : type === 'MOBILE_MONEY' ? ['phoneNumber', 'providerCode'] : ['address', 'network'];
    if (Object.keys(raw).some((key) => !allowed.includes(key)) || Object.values(raw).some((value) => typeof value !== 'string' || !value.trim() || value.length > 200)) {
      throw new ConflictException('Destination fields do not match the selected type');
    }
    const destination = raw as Record<string, string>;
    const required = type === 'BANK' ? ['bankCode'] : type === 'MOBILE_MONEY' ? ['phoneNumber', 'providerCode'] : ['address', 'network'];
    if (required.some((key) => !destination[key]) || type === 'BANK' && !destination.accountNumber && !destination.iban) {
      throw new ConflictException('Required destination details are missing');
    }
    if (type === 'MOBILE_MONEY' && !/^\+[1-9]\d{6,14}$/.test(destination.phoneNumber)) {
      throw new ConflictException('Mobile money phone number must use E.164 format');
    }
    return Object.fromEntries(Object.entries(destination).map(([key, value]) => [key, value.trim()]));
  }

  private async audit(principal: TenantPrincipal, action: string, resourceType: string, resourceId: string | null) {
    await this.pool.query(
      `INSERT INTO audit_logs (institution_id, actor_user_id, actor_credential_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [principal.institutionId, userId(principal), credentialId(principal), action, resourceType, resourceId,
        JSON.stringify('sessionId' in principal ? { sessionId: principal.sessionId } : { credentialId: principal.credentialId })],
    );
  }
}

function userId(principal: TenantPrincipal): string | null { return 'userId' in principal ? principal.userId : null; }
function credentialId(principal: TenantPrincipal): string | null { return 'credentialId' in principal ? principal.credentialId : null; }

function mask(value: string): string {
  const normalized = value.replace(/\s/g, '');
  return `${'•'.repeat(Math.min(8, Math.max(0, normalized.length - 4)))}${normalized.slice(-4)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
