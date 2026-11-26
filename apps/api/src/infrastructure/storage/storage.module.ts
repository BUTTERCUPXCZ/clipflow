import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { MediaStorage } from './media-storage.js';

@Global()
@Module({
  providers: [
    {
      provide: MediaStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => new MediaStorage(config.get('MEDIA_ROOT', { infer: true })),
    },
  ],
  exports: [MediaStorage],
})
export class StorageModule {}
