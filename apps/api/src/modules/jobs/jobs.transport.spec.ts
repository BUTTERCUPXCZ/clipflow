import { createServer } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import WebSocket from 'ws';
import { GRPC_LOADER_OPTIONS, JOB_EVENTS_PROTO_PATH } from '../../infrastructure/grpc/grpc.module.js';
import { EventsGateway } from './events.gateway.js';
import { JobEventsHandler } from './job-events.handler.js';
import { JobEventsController, JobsController } from './jobs.controller.js';
import type { Job } from './jobs.repository.js';
import { JobsService } from './jobs.service.js';

const ID = '6f1b8c5e-3d2a-4c1b-9e8f-0a1b2c3d4e5f';

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

/** Real transports: HTTP (supertest), WebSocket (ws client) and the gRPC JobEventsService server. */
describe('jobs over HTTP, WebSocket and gRPC', () => {
  let app: INestApplication;
  let httpPort: number;
  let grpcUrl: string;
  const service = {
    process: vi.fn(async () => ({ id: ID, status: 'PENDING' })),
    framePath: vi.fn(async () => JOB_EVENTS_PROTO_PATH), // any readable file
  };
  const handler = { progress: vi.fn(async () => ({ applied: true, stop: false })) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [JobsController, JobEventsController],
      providers: [
        EventsGateway,
        { provide: JobsService, useValue: service },
        { provide: JobEventsHandler, useValue: handler },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    app.useWebSocketAdapter(new WsAdapter(app));
    grpcUrl = `127.0.0.1:${await freePort()}`;
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.GRPC,
      options: { package: 'ai.v1', protoPath: JOB_EVENTS_PROTO_PATH, url: grpcUrl, loader: GRPC_LOADER_OPTIONS },
    });
    await app.startAllMicroservices();
    await app.listen(0, '127.0.0.1');
    httpPort = (app.getHttpServer().address() as { port: number }).port;
  });
  afterAll(() => app.close());

  it('starts processing with 202 and rejects a malformed id', async () => {
    expect((await request(app.getHttpServer()).post(`/videos/${ID}/process`)).status).toBe(202);
    expect((await request(app.getHttpServer()).post('/videos/nope/process')).status).toBe(400);
  });

  it('streams a frame as image/jpeg and validates the index', async () => {
    const res = await request(app.getHttpServer()).get(`/jobs/${ID}/frames/2`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(service.framePath).toHaveBeenCalledWith(expect.any(String), ID, 2);
    expect((await request(app.getHttpServer()).get(`/jobs/${ID}/frames/-1`)).status).toBe(400);
  });

  it('pushes job.updated to a desktop WebSocket', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`, { origin: 'http://localhost:1420' });
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
    const received = new Promise<string>((resolve) => socket.once('message', (data) => resolve((data as Buffer).toString('utf8'))));

    app.get(EventsGateway).jobUpdated({ id: ID, status: 'VALIDATING' } as Job);

    expect(JSON.parse(await received)).toEqual({ event: 'job.updated', data: { id: ID, status: 'VALIDATING' } });
    socket.close();
  });

  it('refuses a WebSocket from any other origin', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`, { origin: 'https://evil.example' });

    const outcome = await new Promise<string>((resolve) => {
      socket.once('open', () => resolve('open'));
      socket.once('unexpected-response', (_req, res) => resolve(`refused ${res.statusCode}`));
      socket.once('error', () => resolve('refused'));
    });

    expect(outcome).toMatch(/^refused/);
  });

  it('serves JobEventsService to the worker over gRPC', async () => {
    const definition = protoLoader.loadSync(JOB_EVENTS_PROTO_PATH, GRPC_LOADER_OPTIONS);
    const ai = (grpc.loadPackageDefinition(definition) as unknown as { ai: { v1: Record<string, grpc.ServiceClientConstructor> } }).ai.v1;
    const client = new ai.JobEventsService(grpcUrl, grpc.credentials.createInsecure());

    const ack = await new Promise<{ applied: boolean; stop: boolean }>((resolve, reject) =>
      client.ReportProgress(
        { jobId: ID, sequence: 7, status: 'JOB_STATUS_EXTRACTING_MEDIA', stage: 'x', progress: 40, message: '' },
        (error: grpc.ServiceError | null, response: { applied: boolean; stop: boolean }) =>
          error ? reject(error) : resolve(response),
      ),
    );

    expect(ack).toEqual({ applied: true, stop: false });
    expect(handler.progress).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: ID, sequence: 7, status: 'JOB_STATUS_EXTRACTING_MEDIA', progress: 40 }),
    );
    client.close();
  });
});
