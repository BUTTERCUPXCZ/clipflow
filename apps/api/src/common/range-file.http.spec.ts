import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller, Get, Headers, type INestApplication, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { sendFile } from './range-file.js';

/** Locks in what video seeking needs through the real Nest + Express pipeline: 206 survives `passthrough`. */
describe('sendFile over HTTP', () => {
  let app: INestApplication;
  let file: string;

  beforeAll(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'clipforge-range-')), 'f.mp4');
    await writeFile(file, Buffer.alloc(1000, 1));

    @Controller()
    class FileController {
      @Get('file')
      get(@Headers('range') range: string | undefined, @Res({ passthrough: true }) res: Response) {
        return sendFile(file, 'video/mp4', range, res);
      }

      @Get('missing')
      missing(@Res({ passthrough: true }) res: Response) {
        return sendFile('', 'video/mp4', undefined, res);
      }
    }

    const moduleRef = await Test.createTestingModule({ controllers: [FileController] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('answers 200, 206, 416 and 404 as players expect', async () => {
    const whole = await request(app.getHttpServer()).get('/file');
    expect([whole.status, whole.headers['content-length'], whole.headers['accept-ranges']]).toEqual([200, '1000', 'bytes']);

    const part = await request(app.getHttpServer()).get('/file').set('Range', 'bytes=0-99');
    expect([part.status, part.headers['content-length'], part.headers['content-range']]).toEqual([206, '100', 'bytes 0-99/1000']);

    const past = await request(app.getHttpServer()).get('/file').set('Range', 'bytes=2000-');
    expect([past.status, past.headers['content-range']]).toEqual([416, 'bytes */1000']);

    expect((await request(app.getHttpServer()).get('/missing')).status).toBe(404);
  });
});
