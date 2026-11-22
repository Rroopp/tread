import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PROVIDER_CAPABILITIES = ['BANK_RAIL', 'FX_LIQUIDITY', 'CUSTODY', 'BLOCKCHAIN', 'KYC_KYB', 'AML_SANCTIONS', 'TRAVEL_RULE'] as const;

export class CreateProviderIntegrationDto {
  @ApiProperty({ example: 'northstar_fx_sandbox' })
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  providerCode!: string;

  @ApiProperty({ example: 'Northstar FX Sandbox' })
  @IsString() @MaxLength(120)
  displayName!: string;

  @ApiProperty({ enum: PROVIDER_CAPABILITIES })
  @IsIn(PROVIDER_CAPABILITIES)
  capability!: (typeof PROVIDER_CAPABILITIES)[number];

  @ApiProperty({ enum: ['SANDBOX', 'PRODUCTION'] })
  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment!: 'SANDBOX' | 'PRODUCTION';

  @ApiProperty({ example: 'northstar_fx_sandbox' })
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  adapterKey!: string;

  @ApiPropertyOptional({ example: 'vault:secret/data/tread/northstar-fx' })
  @IsOptional() @IsString() @MaxLength(240)
  @Matches(/^(vault|aws-secretsmanager|gcp-secret-manager|azure-key-vault):[A-Za-z0-9/_:=.-]+$/)
  secretReference?: string;
}

export class UpdateProviderIntegrationStatusDto {
  @ApiProperty({ enum: ['DISABLED', 'CONFIGURED'] })
  @IsIn(['DISABLED', 'CONFIGURED'])
  status!: 'DISABLED' | 'CONFIGURED';
}

export class InstitutionReviewDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiProperty({ minLength: 5, maxLength: 2000 })
  @IsString() @MinLength(5) @MaxLength(2000)
  reason!: string;
}
