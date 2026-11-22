import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'operator@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  institutionId!: string;

  @ApiProperty({ required: false, description: 'Six-digit TOTP code, if MFA is enrolled' })
  @IsOptional() @IsString() @Matches(/^\d{6}$/)
  totpCode?: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'One-time invitation token' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  invitationToken!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class RefreshSessionDto {
  @ApiProperty({ description: 'Current one-time refresh token' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  refreshToken!: string;
}

export class MfaChallengeDto {
  @ApiProperty({ description: 'Short-lived MFA challenge token returned after password verification' })
  @IsString() @Matches(/^[A-Za-z0-9_.-]{40,2048}$/)
  challengeToken!: string;
}

export class MfaVerifyDto extends MfaChallengeDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @Matches(/^\d{6}$/)
  totpCode?: string;

  @ApiProperty({ required: false, description: 'One-time recovery code; invalidates that code after use' })
  @IsOptional() @IsString() @Matches(/^[A-Fa-f0-9-]{24,40}$/)
  recoveryCode?: string;
}

export class MfaConfirmDto extends MfaChallengeDto {
  @ApiProperty({ description: 'Current six-digit authenticator code' })
  @IsString() @Matches(/^\d{6}$/)
  totpCode!: string;
}

export class MfaEnrollmentConfirmDto {
  @ApiProperty({ description: 'Current six-digit authenticator code' })
  @IsString() @Matches(/^\d{6}$/)
  totpCode!: string;
}
