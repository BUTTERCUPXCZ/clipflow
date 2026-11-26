/** Tracks the copies in flight so a delete can cancel one. In-memory: one API process owns all imports. */
export class ImportRegistry {
  private readonly running = new Map<string, AbortController>();

  start(videoId: string): AbortSignal {
    const controller = new AbortController();
    this.running.set(videoId, controller);
    return controller.signal;
  }

  /** @returns true when a running copy was told to stop */
  abort(videoId: string): boolean {
    const controller = this.running.get(videoId);
    controller?.abort();
    return controller !== undefined;
  }

  finish(videoId: string): void {
    this.running.delete(videoId);
  }

  isRunning(videoId: string): boolean {
    return this.running.has(videoId);
  }
}
