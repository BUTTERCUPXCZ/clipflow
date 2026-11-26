/**
 * Live updates from the API (system-design §12): one WebSocket for the whole app, reconnecting with
 * exponential backoff. Messages are notifications only; on every (re)connect listeners are told to
 * refetch, because events sent while disconnected are lost and REST is the source of truth.
 */
export type ConnectionState = "connecting" | "open" | "closed";

export interface ServerEvent<T = unknown> {
  event: string;
  data: T;
}

type MessageListener = (message: ServerEvent) => void;
type StateListener = (state: ConnectionState) => void;

/** The parts of a browser WebSocket this client uses (tests pass a fake with the same shape). */
type SocketLike = Pick<WebSocket, "onopen" | "onclose" | "onerror" | "onmessage" | "close">;

export type SocketFactory = (url: string) => SocketLike;

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export class EventsClient {
  private socket: SocketLike | undefined;
  private state: ConnectionState = "closed";
  private delay = MIN_DELAY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(
    readonly url: string,
    private readonly createSocket: SocketFactory = (u) => new WebSocket(u),
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = undefined;
    this.setState("closed");
  }

  getState(): ConnectionState {
    return this.state;
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private connect(): void {
    this.setState("connecting");
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.delay = MIN_DELAY_MS;
      this.setState("open");
    };
    socket.onmessage = (event) => this.dispatch(event.data);
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.setState("closed");
      if (!this.stopped) this.retryTimer = setTimeout(() => this.connect(), this.nextDelay());
    };
  }

  private nextDelay(): number {
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    return delay;
  }

  private dispatch(raw: unknown): void {
    let message: ServerEvent;
    try {
      message = JSON.parse(String(raw)) as ServerEvent;
    } catch {
      return; // not ours; ignore
    }
    if (typeof message?.event !== "string") return;
    for (const listener of this.messageListeners) listener(message);
  }

  private setState(state: ConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

/** ws://host:port/ws next to the REST API (`http://host:port/api/v1`). */
export function eventsUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}
