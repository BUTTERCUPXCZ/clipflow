import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/** HTTP contract: routing, status codes and validation (service faked; no DB). */
describe('ProjectsController over HTTP', () => {
  let app: INestApplication;
  const service = {
    create: vi.fn(async (_u: string, body: object) => ({ id: 'p1', ...body })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => ({ id: 'p1' })),
    update: vi.fn(async () => ({ id: 'p1' })),
    delete: vi.fn(async () => {}),
  };
  const ID = '6f1b8c5e-3d2a-4c1b-9e8f-0a1b2c3d4e5f';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it('creates with 201 and a trimmed name', async () => {
    const res = await request(app.getHttpServer()).post('/projects').send({ name: '  Podcast  ' });

    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.any(String), { name: 'Podcast' });
  });

  it('stores a blank description as null', async () => {
    await request(app.getHttpServer()).post('/projects').send({ name: 'Podcast', description: '   ' });

    expect(service.create).toHaveBeenCalledWith(expect.any(String), { name: 'Podcast', description: null });
  });

  it.each([
    [{}, 'Name is required'],
    [{ name: '   ' }, 'Name is required'],
    [{ name: 'x'.repeat(101) }, 'at most 100'],
    [{ name: 'ok', description: 'x'.repeat(1001) }, 'at most 1000'],
  ])('rejects %j with 400', async (body, message) => {
    const res = await request(app.getHttpServer()).post('/projects').send(body);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(message);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed id with 400 before reaching the service', async () => {
    const res = await request(app.getHttpServer()).get('/projects/not-a-uuid');

    expect(res.status).toBe(400);
    expect(service.get).not.toHaveBeenCalled();
  });

  it('rejects an empty PATCH with 400', async () => {
    const res = await request(app.getHttpServer()).patch(`/projects/${ID}`).send({});

    expect(res.status).toBe(400);
  });

  it('deletes with 204 and no body', async () => {
    const res = await request(app.getHttpServer()).delete(`/projects/${ID}`);

    expect(res.status).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(expect.any(String), ID);
  });
});
