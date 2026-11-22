import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../identity/api-key.decorator';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { InstitutionRolesGuard } from '../identity/institution-roles.guard';
import { RequireInstitutionRoles } from '../identity/institution-roles.decorator';
import { UserPrincipal } from '../identity/api-key.types';
import { CreateTeamInvitationDto } from './team.dto';
import { InstitutionsService } from './institutions.service';

@ApiTags('institution team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, InstitutionRolesGuard)
@RequireInstitutionRoles('OWNER', 'ADMIN')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('institutions/current/team')
export class TeamController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Get()
  @ApiOperation({ summary: 'List institution team members' })
  listMembers(@CurrentUser() principal: UserPrincipal) {
    return this.institutions.listTeamMembers(principal.institutionId);
  }

  @Get('invitations')
  @ApiOperation({ summary: 'List pending team invitations' })
  listInvitations(@CurrentUser() principal: UserPrincipal) {
    return this.institutions.listTeamInvitations(principal.institutionId);
  }

  @Post('invitations')
  @ApiCreatedResponse({ description: 'Invitation created; the token is returned once' })
  @ApiOperation({ summary: 'Invite a team member' })
  createInvitation(
    @CurrentUser() principal: UserPrincipal,
    @Body() body: CreateTeamInvitationDto,
  ) {
    return this.institutions.inviteTeamMember(principal, body.email, body.role);
  }

  @Delete('invitations/:invitationId')
  @ApiOperation({ summary: 'Revoke a pending team invitation' })
  revokeInvitation(
    @CurrentUser() principal: UserPrincipal,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
  ) {
    return this.institutions.revokeTeamInvitation(principal, invitationId);
  }
}
