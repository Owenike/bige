export const BIGE_BOARD_PREFETCH_RADIUS = 10;
export const BIGE_BOARD_PREFETCH_CONCURRENCY = 2;

export function shiftBigeBoardDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function buildBigeBoardPrefetchDates(
  centerDate: string,
  radius = BIGE_BOARD_PREFETCH_RADIUS,
) {
  const dates: string[] = [];
  for (let distance = 1; distance <= radius; distance += 1) {
    dates.push(shiftBigeBoardDate(centerDate, -distance));
    dates.push(shiftBigeBoardDate(centerDate, distance));
  }
  return dates;
}

type BigeBoardPrefetchOptions = {
  run: (targetDate: string) => Promise<unknown>;
  shouldSkip?: (targetDate: string) => boolean;
};

export class BigeBoardPrefetchQueue {
  private readonly maxConcurrency: number;
  private activeCount = 0;
  private pendingDates: string[] = [];
  private pendingSet = new Set<string>();
  private run: BigeBoardPrefetchOptions["run"] = async () => undefined;
  private shouldSkip: NonNullable<BigeBoardPrefetchOptions["shouldSkip"]> = () => false;

  constructor(maxConcurrency = BIGE_BOARD_PREFETCH_CONCURRENCY) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error("Prefetch concurrency must be a positive integer");
    }
    this.maxConcurrency = maxConcurrency;
  }

  replace(targetDates: string[], options: BigeBoardPrefetchOptions) {
    this.run = options.run;
    this.shouldSkip = options.shouldSkip || (() => false);
    this.pendingDates = [];
    this.pendingSet.clear();

    for (const targetDate of targetDates) {
      if (
        this.pendingSet.has(targetDate) ||
        this.shouldSkip(targetDate)
      ) {
        continue;
      }
      this.pendingDates.push(targetDate);
      this.pendingSet.add(targetDate);
    }

    this.drain();
  }

  prioritize(targetDate: string) {
    if (!this.pendingSet.delete(targetDate)) return;
    this.pendingDates = this.pendingDates.filter((date) => date !== targetDate);
  }

  clear() {
    this.pendingDates = [];
    this.pendingSet.clear();
  }

  getState() {
    return {
      activeCount: this.activeCount,
      pendingDates: [...this.pendingDates],
    };
  }

  private drain() {
    while (
      this.activeCount < this.maxConcurrency &&
      this.pendingDates.length > 0
    ) {
      const targetDate = this.pendingDates.shift();
      if (!targetDate) break;
      this.pendingSet.delete(targetDate);
      if (this.shouldSkip(targetDate)) continue;

      this.activeCount += 1;
      void this.run(targetDate)
        .catch(() => undefined)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }
}
