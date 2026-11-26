import { Module } from '@nestjs/common';
import { MediaStorage } from '../../infrastructure/storage/media-storage.js';
import { GrpcModule } from '../../infrastructure/grpc/grpc.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ImportRegistry } from './import/import-registry.js';
import { ImportValidator } from './import/import-validator.js';
import { MediaCopier } from './import/media-copier.js';
import { VideosController } from './videos.controller.js';
import { VideosRepository } from './videos.repository.js';
import { VideosService } from './videos.service.js';

@Module({
  imports: [ProjectsModule, GrpcModule],
  controllers: [VideosController],
  providers: [
    VideosService,
    VideosRepository,
    { provide: ImportValidator, inject: [MediaStorage], useFactory: (storage: MediaStorage) => new ImportValidator(storage) },
    { provide: MediaCopier, useValue: new MediaCopier() },
    { provide: ImportRegistry, useValue: new ImportRegistry() },
  ],
  exports: [VideosRepository],
})
export class VideosModule {}
