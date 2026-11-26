export interface Check {
  status: 'ok' | 'error';
  detail: string;
}

/** One dependency probe. Returns named results; must not throw (failures become error Checks). */
export interface HealthIndicator {
  check(): Promise<Record<string, Check>>;
}

/** Multi-provider token: HealthService receives every registered indicator. */
export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');

export const ok = (detail: string): Check => ({ status: 'ok', detail });
export const error = (detail: string): Check => ({ status: 'error', detail });
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
