import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateTransactionDto {
  @ApiProperty({ example: 'KES', description: 'Enabled asset code; use this together with amountMinor when no quoteId is supplied', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/)
  assetCode?: string;

  @ApiProperty({ example: '250000', description: 'Amount in the asset’s smallest unit, as an integer string; required without quoteId', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{0,37}$/)
  amountMinor?: string;

  @ApiProperty({ format: 'uuid', required: false, description: 'Consumes an active quote and initializes the transaction in QUOTED state' })
  @IsOptional()
  @IsUUID()
  quoteId?: string;

  @ApiPropertyOptional({ example: 'supplier-invoice-4821' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientReference?: string;
}
