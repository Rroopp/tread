import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AcceptInvitationDto, LoginDto, MfaChallengeDto, MfaConfirmDto, MfaEnrollmentConfirmDto, MfaVerifyDto, RefreshSessionDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser } from './api-key.decorator';
import { UserPrincipal } from './api-key.types';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('identity')
@Controller('auth')
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('accept-invitation')
  @ApiOperation({ summary: 'Set a password and accept an institution invitation' })
  acceptInvitation(@Body() body: AcceptInvitationDto) {
    return this.auth.acceptInvitation(body.invitationToken, body.password);
  }

  @Post('login')
  @ApiOperation({ summary: 'Start a user session for an institution' })
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password, body.institutionId, body.totpCode);
  }

  @Post('mfa/setup')
  @ApiOperation({ summary: 'Start required MFA enrollment using a short-lived password-verified setup challenge' })
  startMfaSetup(@Body() body: MfaChallengeDto) { return this.auth.startMfaSetup(body.challengeToken); }

  @Post('mfa/confirm')
  @ApiOperation({ summary: 'Confirm TOTP enrollment and receive one-time recovery codes' })
  confirmMfaSetup(@Body() body: MfaConfirmDto) { return this.auth.confirmMfaSetup(body.challengeToken, body.totpCode); }

  @Post('mfa/verify')
  @ApiOperation({ summary: 'Complete password login with a TOTP or one-time recovery code' })
  finishMfaLogin(@Body() body: MfaVerifyDto) {
    if (Boolean(body.totpCode) === Boolean(body.recoveryCode)) throw new BadRequestException('Provide exactly one MFA code');
    return this.auth.finishMfaLogin(body.challengeToken, body.totpCode, body.recoveryCode);
  }

  @Post('mfa/enrollment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start optional MFA enrollment for the current institution user' })
  startOptionalMfa(@CurrentUser() principal: UserPrincipal) { return this.auth.startOptionalMfaEnrollment(principal); }

  @Post('mfa/enrollment/confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm optional MFA enrollment and receive one-time recovery codes' })
  confirmOptionalMfa(@CurrentUser() principal: UserPrincipal, @Body() body: MfaEnrollmentConfirmDto) {
    return this.auth.confirmOptionalMfaEnrollment(principal, body.totpCode);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a one-time refresh token' })
  refresh(@Body() body: RefreshSessionDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current user session' })
  logout(@CurrentUser() principal: UserPrincipal) {
    return this.auth.logout(principal);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user and institution context' })
  me(@CurrentUser() principal: UserPrincipal) {
    return this.auth.currentUser(principal);
  }
}
