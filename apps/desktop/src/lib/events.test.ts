import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventsClient, eventsUrl, type SocketFactory } from "./events";

class FakeSocket {
  onopen: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  closed = false;

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({});
  }
  open() {
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const factory = (() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  }) as unknown as SocketFactory;
  return { client: new EventsClient("ws://api.test/ws", factory), sockets };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("EventsClient", () => {
  it("delivers parsed events and ignores anything malformed", () => {
    const { client, sockets } = setup();
    const received: unknown[] = [];
    client.onMessage((m) => received.push(m));
    client.start();
    sockets[0].open();

    sockets[0].receive(JSON.stringify({ event: "job.updated", data: { id: "j1" } }));
    sockets[0].receive("not json");
    sockets[0].receive(JSON.stringify({ hello: 1 }));

    expect(received).toEqual([{ event: "job.updated", data: { id: "j1" } }]);
  });

  it("reports its state and reconnects with growing delays after drops", () => {
    const { client, sockets } = setup();
    const states: string[] = [];
    client.onState((s) => states.push(s));
    client.start();

    sockets[0].close(); // never opened
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2); // retried after 1 s

    sockets[1].close();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3); // then after 2 s

    sockets[2].open();
    expect(states.at(-1)).toBe("open");
    sockets[2].close();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(4); // a successful open resets the delay
  });

  it("stops reconnecting once stopped", () => {
    const { client, sockets } = setup();
    client.start();
    client.stop();

    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(client.getState()).toBe("closed");
  });

  it("derives the socket URL from the REST base URL", () => {
    expect(eventsUrl("http://localhost:3000/api/v1")).toBe("ws://localhost:3000/ws");
    expect(eventsUrl("https://example.test/api/v1")).toBe("wss://example.test/ws");
  });
});
