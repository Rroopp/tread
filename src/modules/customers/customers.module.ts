import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { DataEncryptionService } from './data-encryption.service';
import { CustomersApiController } from './customers-api.controller';

@Module({ imports: [IdentityModule], controllers: [CustomersController, CustomersApiController], providers: [CustomersService, DataEncryptionService] })
export class CustomersModule {}
