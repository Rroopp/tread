import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the API process is running' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether the API can reach required infrastructure' })
  async ready() {
    const databaseReady = await this.healthService.isDatabaseReady();
    if (!databaseReady) {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok', dependencies: { database: 'ok' } };
  }
}
