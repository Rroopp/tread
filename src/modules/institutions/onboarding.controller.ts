import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InstitutionsService } from './institutions.service';
import { SubmitInstitutionOnboardingDto } from './onboarding.dto';

@ApiTags('institution onboarding')
@Controller('onboarding/institutions')
export class OnboardingController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit an institution for onboarding review' })
  @ApiCreatedResponse({ description: 'Application recorded for manual review' })
  submit(@Body() body: SubmitInstitutionOnboardingDto) {
    return this.institutions.submitOnboarding(body);
  }
}
