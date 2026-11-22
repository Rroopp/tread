import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CreateQuoteDto {
  @ApiProperty({ example: 'KES' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/)
  sourceAssetCode!: string;

  @ApiProperty({ example: 'USDC' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,12}$/)
  destinationAssetCode!: string;

  @ApiProperty({ example: '13000', description: 'Source amount in its smallest unit, as an integer string' })
  @IsString()
  @Matches(/^[1-9][0-9]{0,37}$/)
  sourceAmountMinor!: string;
}
