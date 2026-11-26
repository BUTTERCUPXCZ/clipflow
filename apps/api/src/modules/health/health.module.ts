import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { HealthController } from './health.controller.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator.js';
import { HealthService } from './health.service.js';
import { AiServiceHealthIndicator } from './indicators/ai-service.indicator.js';
import { DatabaseHealthIndicator } from './indicators/database.indicator.js';

/** Register a new dependency check by adding its indicator class here. */
const INDICATORS = [DatabaseHealthIndicator, AiServiceHealthIndicator];

@Module({
  imports: [GrpcModule],
  controllers: [HealthController],
  providers: [
    ...INDICATORS,
    {
      provide: HEALTH_INDICATORS,
      inject: INDICATORS,
      useFactory: (...indicators: HealthIndicator[]) => indicators,
    },
    HealthService,
  ],
})
export class HealthModule {}
