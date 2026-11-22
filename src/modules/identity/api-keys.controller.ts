import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './api-key.decorator';
import { UserPrincipal } from './api-key.types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InstitutionRolesGuard } from './institution-roles.guard';
import { RequireInstitutionRoles } from './institution-roles.decorator';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './api-keys.dto';

@ApiTags('institution API credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@RequireInstitutionRoles('OWNER', 'ADMIN')
@Controller('institutions/current/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Get()
  @ApiOperation({ summary: 'List institution API credentials without revealing secret material' })
  list(@CurrentUser() user: UserPrincipal) {
    return this.apiKeys.list(user.institutionId);
  }

  @Post()
  @ApiCreatedResponse({ description: 'Credential created; plaintext token is returned once' })
  @ApiOperation({ summary: 'Create an API credential for an active institution environment' })
  create(@CurrentUser() user: UserPrincipal, @Body() body: CreateApiKeyDto) {
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined;
    return this.apiKeys.issueForEnvironment(user.institutionId, body.environment, body.name, body.scopes, expiresAt, user.userId);
  }

  @Delete(':credentialId')
  @ApiOperation({ summary: 'Revoke an active institution API credential' })
  revoke(@CurrentUser() user: UserPrincipal, @Param('credentialId', new ParseUUIDPipe()) credentialId: string) {
    return this.apiKeys.revoke(user.institutionId, credentialId, user.userId);
  }
}
