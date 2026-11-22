import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RequestMethod } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http/api-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const trustedProxyCidrs = config.get<string>('TRUSTED_PROXY_CIDRS', '')
    .split(',')
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  if (trustedProxyCidrs.length > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustedProxyCidrs);

  app.use((request: { requestId?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    next();
  });
  app.use(helmet());
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: '', method: RequestMethod.GET },
      { path: 'favicon.ico', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const allowedOrigins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  });

  if (config.get<string>('NODE_ENV') !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TREAD API')
        .setDescription('Versioned API for TREAD financial infrastructure.')
        .setVersion('1.0.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}

void bootstrap();
