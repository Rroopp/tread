import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: 'customer-1042' })
  @IsString() @MinLength(2) @MaxLength(120) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  externalReference!: string;

  @ApiProperty({ enum: ['INDIVIDUAL', 'BUSINESS'] })
  @IsIn(['INDIVIDUAL', 'BUSINESS'])
  customerType!: 'INDIVIDUAL' | 'BUSINESS';

  @ApiProperty({ example: 'KE' })
  @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty({ example: 'Example Customer' })
  @IsString() @MinLength(1) @MaxLength(160)
  displayName!: string;

  @ApiPropertyOptional({ example: 'customer@example.com' })
  @IsOptional() @IsEmail() @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: '+254700000000' })
  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;
}

export class CreateBeneficiaryDto {
  @ApiProperty({ example: 'supplier-876' })
  @IsString() @MinLength(2) @MaxLength(120) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  externalReference!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  customerId?: string;

  @ApiProperty({ enum: ['BANK', 'MOBILE_MONEY', 'CRYPTO_WALLET'] })
  @IsIn(['BANK', 'MOBILE_MONEY', 'CRYPTO_WALLET'])
  destinationType!: 'BANK' | 'MOBILE_MONEY' | 'CRYPTO_WALLET';

  @ApiProperty({ example: 'KE' })
  @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode!: string;

  @ApiProperty({ example: 'KES' })
  @IsString() @Matches(/^[A-Z0-9]{2,12}$/)
  currencyCode!: string;

  @ApiProperty({ example: 'Example Supplier' })
  @IsString() @MinLength(1) @MaxLength(160)
  displayName!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  destinationDetails!: Record<string, unknown>;
}
