import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { RequireSystemAdminScopes } from './system-admin.decorator';
import { SystemAdminGuard } from './system-admin.guard';
import { AdminOpsService } from './admin-ops.service';
import { CreateProviderIntegrationDto, InstitutionReviewDto, UpdateProviderIntegrationStatusDto } from './provider-integration.dto';

@ApiTags('internal administration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('internal/admin')
export class AdminOpsController {
  constructor(private readonly admin: AdminOpsService) {}

  @Get('overview')
  @RequireSystemAdminScopes('platform:read')
  overview(@CurrentUser() principal: UserPrincipal) { return this.admin.overview(principal); }

  @Get('institutions')
  @RequireSystemAdminScopes('institutions:read')
  institutions(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    return this.admin.institutions(principal, this.parseLimit(limit));
  }

  @Get('onboarding-applications')
  @RequireSystemAdminScopes('institutions:read')
  onboardingApplications(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    return this.admin.onboardingApplications(principal, this.parseLimit(limit));
  }

  @Post('onboarding-applications/:applicationId/review')
  @RequireSystemAdminScopes('institutions:write')
  reviewOnboarding(
    @CurrentUser() principal: UserPrincipal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: InstitutionReviewDto,
  ) { return this.admin.reviewOnboardingApplication(principal, applicationId, body.decision, body.reason); }

  @Post('onboarding-reviews/:reviewId/confirm')
  @RequireSystemAdminScopes('institutions:write')
  confirmOnboarding(@CurrentUser() principal: UserPrincipal, @Param('reviewId', new ParseUUIDPipe()) reviewId: string) {
    return this.admin.confirmOnboardingApproval(principal, reviewId);
  }

  @Get('transactions')
  @RequireSystemAdminScopes('transactions:read')
  transactions(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    return this.admin.transactions(principal, this.parseLimit(limit));
  }

  @Get('compliance-queue')
  @RequireSystemAdminScopes('compliance:read')
  compliance(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    return this.admin.complianceQueue(principal, this.parseLimit(limit));
  }

  @Get('providers')
  @RequireSystemAdminScopes('providers:read')
  providers(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    return this.admin.providerOperations(principal, this.parseLimit(limit));
  }

  @Post('providers/integrations')
  @RequireSystemAdminScopes('providers:write')
  createProvider(@CurrentUser() principal: UserPrincipal, @Body() body: CreateProviderIntegrationDto) {
    return this.admin.createProviderIntegration(principal, body);
  }

  @Patch('providers/integrations/:integrationId/status')
  @RequireSystemAdminScopes('providers:write')
  updateProviderStatus(
    @CurrentUser() principal: UserPrincipal,
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
    @Body() body: UpdateProviderIntegrationStatusDto,
  ) {
    return this.admin.updateProviderIntegrationStatus(principal, integrationId, body.status);
  }

  private parseLimit(value?: string): number {
    const limit = value === undefined ? 50 : Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be an integer from 1 to 100');
    return limit;
  }
}
