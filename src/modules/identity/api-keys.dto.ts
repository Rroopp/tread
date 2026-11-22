import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export const API_KEY_SCOPES = [
  'transactions:read', 'transactions:write', 'transactions:sandbox_simulate',
  'accounts:read', 'accounts:write', 'quotes:read', 'quotes:write',
  'webhooks:read', 'webhooks:write', 'customers:read', 'customers:write',
  'beneficiaries:read', 'beneficiaries:write',
] as const;

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Treasury sandbox integration' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: ['SANDBOX', 'PRODUCTION'] })
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment!: 'SANDBOX' | 'PRODUCTION';

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: (typeof API_KEY_SCOPES)[number][];

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
