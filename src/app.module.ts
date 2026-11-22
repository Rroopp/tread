import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AccountsModule } from './modules/accounts/accounts.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InstitutionsModule } from './modules/institutions/institutions.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { AdminModule } from './modules/admin/admin.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { CustomersModule } from './modules/customers/customers.module';
import { RootController } from './root.controller';

@Module({
  controllers: [RootController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
        SANDBOX_RATES_JSON: Joi.string().default('{}'),
        SANDBOX_COMPLIANCE_OUTCOME: Joi.string().valid('ALLOW', 'DENY', 'REVIEW').default('REVIEW'),
        WEBHOOK_ALLOWED_HOSTS: Joi.string().allow('').default(''),
        WEBHOOK_SECRET_ENCRYPTION_KEY: Joi.string().allow('').default('').when('NODE_ENV', {
          is: 'production',
          then: Joi.string().pattern(/^[A-Za-z0-9+/]{43}=$/).required(),
        }),
        DATA_ENCRYPTION_KEYS_JSON: Joi.string().default('{}').when('NODE_ENV', { is: 'production', then: Joi.string().required() }),
        DATA_ENCRYPTION_CURRENT_KEY_ID: Joi.string().allow('').default('').when('NODE_ENV', { is: 'production', then: Joi.string().pattern(/^[A-Za-z0-9_-]{1,40}$/).required() }),
        DASHBOARD_PUBLIC_URL: Joi.string().uri({ scheme: ['https'] }).when('NODE_ENV', { is: 'production', then: Joi.required() }),
        CORS_ORIGINS: Joi.string().allow('').default(''),
        TRUSTED_PROXY_CIDRS: Joi.string().allow('').default(''),
        AUTH_ACCESS_TOKEN_SECRET: Joi.string()
          .min(32)
          .default('local-development-only-secret-change-before-deployment-000')
          .when('NODE_ENV', {
            is: 'production',
            then: Joi.string()
              .min(32)
              .required()
              .invalid('local-development-only-secret-change-before-deployment-000'),
          }),
        AUTH_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
        AUTH_REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),
      }),
    }),
    DatabaseModule,
    HealthModule,
    IdentityModule,
    AccountsModule,
    InstitutionsModule,
    LedgerModule,
    QuotesModule,
    WebhooksModule,
    ReconciliationModule,
    TransactionsModule,
    ProvidersModule,
    AdminModule,
    CustomersModule,
  ],
})
export class AppModule {}
