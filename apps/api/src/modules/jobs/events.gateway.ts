import { Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'ws';
import { DESKTOP_ORIGINS } from '../../config/env.js';
import type { Job } from './jobs.repository.js';

/** Only the desktop app may listen; any other web page's origin is refused before the upgrade. */
export function isDesktopOrigin(origin: string | undefined): boolean {
  return origin !== undefined && DESKTOP_ORIGINS.includes(origin);
}

/**
 * Pushes job changes to the desktop (system-design §12). Messages are notifications only; the database is
 * the source of truth, and the desktop refetches over REST whenever it (re)connects.
 * Single local user: every connected desktop receives every event.
 */
@WebSocketGateway({
  path: '/ws',
  verifyClient: (info: { origin: string; req: IncomingMessage }) => isDesktopOrigin(info.origin),
})
export class EventsGateway {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  private readonly server!: Server;

  jobUpdated(job: Job): void {
    this.broadcast('job.updated', job);
  }

  private broadcast(event: string, data: unknown): void {
    if (!this.server) return; // not listening (e.g. unit tests)
    const message = JSON.stringify({ event, data });
    for (const client of this.server.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message, (error) => error && this.logger.warn(`websocket send failed: ${error.message}`));
      }
    }
  }
}
