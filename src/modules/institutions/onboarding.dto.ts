import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const BUSINESS_TYPES = ['BANK', 'FINTECH', 'PAYMENT_PROVIDER', 'BUSINESS', 'OTHER'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export class SubmitInstitutionOnboardingDto {
  @ApiProperty({ example: 'Acme Payments Limited' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName!: string;

  @ApiProperty({ example: 'Acme Payments' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @ApiProperty({ example: 'KE', description: 'ISO 3166-1 alpha-2 country code' })
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode!: string;

  @ApiProperty({ enum: BUSINESS_TYPES })
  @IsIn(BUSINESS_TYPES)
  businessType!: BusinessType;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: 'jane@acme.example' })
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;
}
