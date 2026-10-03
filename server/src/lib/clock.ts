export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Mutable clock for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(date: Date | string): void {
    this.current = new Date(date);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Today's UTC calendar date as YYYY-MM-DD. */
export function utcToday(clock: Clock): string {
  return clock.now().toISOString().slice(0, 10);
}
