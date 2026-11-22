import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { SystemAdminGuard } from './system-admin.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule, JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('AUTH_ACCESS_TOKEN_SECRET') }),
  })],
  controllers: [AdminOpsController],
  providers: [AdminOpsService, JwtAuthGuard, SystemAdminGuard],
})
export class AdminModule {}
