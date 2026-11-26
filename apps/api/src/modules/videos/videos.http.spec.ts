import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { VideosController } from './videos.controller.js';
import { VideosService } from './videos.service.js';

/** HTTP contract: routing, status codes and validation (service faked; no DB). */
describe('VideosController over HTTP', () => {
  let app: INestApplication;
  const service = {
    startImport: vi.fn(async () => ({ id: 'v1', status: 'IMPORTING' })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: 'v1' })),
    delete: vi.fn(async () => {}),
  };
  const ID = '6f1b8c5e-3d2a-4c1b-9e8f-0a1b2c3d4e5f';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [{ provide: VideosService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('accepts an import with 202', async () => {
    const res = await request(app.getHttpServer())
      .post(`/projects/${ID}/videos/import`)
      .send({ path: '/home/me/clip.mp4' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: 'v1', status: 'IMPORTING' });
    expect(service.startImport).toHaveBeenCalledWith(expect.any(String), ID, '/home/me/clip.mp4');
  });

  it.each([{}, { path: '' }, { path: 'x'.repeat(4097) }, { path: 42 }])('rejects body %j with 400', async (body) => {
    const res = await request(app.getHttpServer()).post(`/projects/${ID}/videos/import`).send(body);

    expect(res.status).toBe(400);
    expect(service.startImport).not.toHaveBeenCalled();
  });

  it('rejects malformed ids with 400', async () => {
    expect((await request(app.getHttpServer()).get('/videos/nope')).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/projects/nope/videos')).status).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('deletes with 204', async () => {
    const res = await request(app.getHttpServer()).delete(`/videos/${ID}`);

    expect(res.status).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(expect.any(String), ID);
  });
});
