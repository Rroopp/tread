import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateDashboardTransactionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  quoteId!: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional() @IsString() @MaxLength(128)
  clientReference?: string;
}
