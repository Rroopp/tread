import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export const WEBHOOK_EVENT_TYPES = [
  'account.created',
  'quote.created',
  'transaction.created',
  'transaction.status_changed',
  'transaction.compliance_decided',
] as const;

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'https://hooks.example.com/tread' })
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  url!: string;

  @ApiProperty({ example: 'Treasury integration' })
  @IsString()
  @MaxLength(120)
  description!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, isArray: true, example: ['transaction.created', 'transaction.status_changed'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  eventTypes!: (typeof WEBHOOK_EVENT_TYPES)[number][];
}

export class ListWebhookDeliveriesQuery {
  @ApiPropertyOptional({ maximum: 100, minimum: 1, default: 50 })
  @IsOptional()
  @IsString()
  limit?: string;
}
