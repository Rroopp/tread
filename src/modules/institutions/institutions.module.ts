import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InstitutionsController } from './institutions.controller';
import { InstitutionsService } from './institutions.service';
import { OnboardingController } from './onboarding.controller';
import { TeamController } from './team.controller';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [IdentityModule, EmailModule],
  controllers: [InstitutionsController, OnboardingController, TeamController],
  providers: [InstitutionsService],
  exports: [InstitutionsService],
})
export class InstitutionsModule {}
