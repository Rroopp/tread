import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';
import { InstitutionRole } from '../identity/institution-roles.decorator';

export const INVITABLE_ROLES: InstitutionRole[] = ['ADMIN', 'OPERATOR', 'VIEWER', 'COMPLIANCE'];

export class CreateTeamInvitationDto {
  @ApiProperty({ example: 'new.operator@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: INVITABLE_ROLES })
  @IsString()
  @IsIn(INVITABLE_ROLES)
  role!: InstitutionRole;
}
