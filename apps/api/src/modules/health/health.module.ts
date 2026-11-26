import { Module } from '@nestjs/common';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [GrpcModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
