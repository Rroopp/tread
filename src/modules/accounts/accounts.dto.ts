import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: 'treasury-kes', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  accountRef!: string;

  @ApiProperty({ example: 'KES' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/)
  assetCode!: string;

  @ApiProperty({ enum: ['SETTLEMENT', 'FEE', 'SUSPENSE'], description: 'Institution-owned operational accounts; customer subaccounts require the customer module.' })
  @IsIn(['SETTLEMENT', 'FEE', 'SUSPENSE'])
  accountType!: 'SETTLEMENT' | 'FEE' | 'SUSPENSE';
}

export class CreateAccountHoldDto {
  @ApiProperty({ example: '250000', description: 'Hold amount in the account asset minor units' })
  @IsString()
  @Matches(/^[1-9][0-9]{0,37}$/)
  amountMinor!: string;

  @ApiProperty({ format: 'uuid', required: false })
  @IsOptional()
  @IsUUID()
  transactionId?: string;
}
