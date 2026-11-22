import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../identity/api-key.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { CreateWebhookEndpointDto } from './webhooks.dto';
import { WebhooksService } from './webhooks.service';

@ApiTags('institution webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@RequireInstitutionRoles('OWNER', 'ADMIN')
@Controller('institutions/current/webhooks')
export class WebhooksDashboardController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('endpoints')
  async list(@CurrentUser() principal: UserPrincipal) {
    const environmentId = await this.webhooks.activeSandboxEnvironment(principal.institutionId);
    return this.webhooks.list(principal.institutionId, environmentId);
  }

  @Post('endpoints')
  async create(@CurrentUser() principal: UserPrincipal, @Body() body: CreateWebhookEndpointDto) {
    const environmentId = await this.webhooks.activeSandboxEnvironment(principal.institutionId);
    return this.webhooks.create(principal.institutionId, environmentId, body);
  }

  @Delete('endpoints/:endpointId')
  async disable(@CurrentUser() principal: UserPrincipal, @Param('endpointId', new ParseUUIDPipe()) endpointId: string) {
    const environmentId = await this.webhooks.activeSandboxEnvironment(principal.institutionId);
    return this.webhooks.disable(principal.institutionId, environmentId, endpointId);
  }

  @Get('deliveries')
  async deliveries(@CurrentUser() principal: UserPrincipal, @Query('limit') limit?: string) {
    const parsed = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new BadRequestException('limit must be an integer from 1 to 100');
    const environmentId = await this.webhooks.activeSandboxEnvironment(principal.institutionId);
    return this.webhooks.listDeliveries(principal.institutionId, environmentId, parsed);
  }
}
