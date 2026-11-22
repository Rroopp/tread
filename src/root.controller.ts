import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class RootController {
  @Get()
  root() {
    return {
      service: 'TREAD API',
      status: 'ok',
      api: '/v1',
      documentation: '/docs',
      health: '/v1/health/live',
    };
  }

  @Get('favicon.ico')
  @HttpCode(204)
  favicon(): void {}
}
