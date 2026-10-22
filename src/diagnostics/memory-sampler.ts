import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export interface MemoryStatsResult {
  peakAggregateRssMb: number;
  peakNodeRssMb: number;
  peakChildRssMb: number;
  peakHeapUsedMb: number;
  peakExternalMb: number;
  peakArrayBuffersMb: number;
  initialNodeRssMb: number;
  finalNodeRssMb: number;
  pageSizeBytes: number;
  sampleCount: number;
}

export interface MemoryTickSnapshot {
  aggregateRssMb: number;
  nodeRssMb: number;
  childRssMb: number;
}

export interface MemorySamplerOptions {
  intervalMs?: number;
  /** Optional hard-fail ceiling in MB; triggers `onHardFailExceeded` on the first tick strictly above this limit. */
  hardFailThresholdMb?: number;
  /** Invoked synchronously on the first sample tick where `aggregateRssMb > hardFailThresholdMb`. */
  onHardFailExceeded?: (snapshot: MemoryTickSnapshot) => void;
}

const DEFAULT_PAGE_SIZE_BYTES = 4096;

function toMb(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Samples resident set size (RSS) of this Node process and one child process (FFmpeg) and
 * tracks peaks. The aggregate RSS (Node + child) is the value checked by the memory gate.
 *
 * RSS is read from `/proc/<pid>/statm`, so this sampler supports Linux (including WSL2) only.
 * A child that has already exited counts as 0 bytes.
 */
export class PipelineMemorySampler {
  private timer: NodeJS.Timeout | null = null;
  private childPid: number | null = null;
  private readonly intervalMs: number;
  private readonly pageSizeBytes: number;
  private readonly hardFailThresholdMb?: number;
  private readonly onHardFailExceeded?: (snapshot: MemoryTickSnapshot) => void;
  private hardFailTriggered = false;
  private samplingError: Error | null = null;

  private peakAggregateRss = 0;
  private peakNodeRss = 0;
  private peakChildRss = 0;
  private peakHeapUsed = 0;
  private peakExternal = 0;
  private peakArrayBuffers = 0;

  private lastTickSnapshot: MemoryTickSnapshot = {
    aggregateRssMb: 0,
    nodeRssMb: 0,
    childRssMb: 0
  };

  private initialNodeRss = 0;
  private finalNodeRss = 0;
  private sampleCount = 0;

  constructor(optionsOrInterval: number | MemorySamplerOptions = 50) {
    if (typeof optionsOrInterval === 'number') {
      this.intervalMs = optionsOrInterval;
    } else {
      this.intervalMs = optionsOrInterval.intervalMs ?? 50;
      this.hardFailThresholdMb = optionsOrInterval.hardFailThresholdMb;
      this.onHardFailExceeded = optionsOrInterval.onHardFailExceeded;
    }
    this.pageSizeBytes = this.detectPageSize();
  }

  /**
   * Dynamically sets or clears the active child process PID (e.g. per-chunk FFmpeg instance).
   * When a non-null PID is attached, an immediate synchronous sample is taken so even
   * short-lived child processes are guaranteed to be measured while alive.
   */
  public setChildPid(pid: number | null): void {
    this.childPid = pid ?? null;
    if (this.childPid !== null) {
      this.sample();
    }
  }

  public getChildPid(): number | null {
    return this.childPid;
  }

  public getLastTickSnapshot(): MemoryTickSnapshot {
    return this.lastTickSnapshot;
  }

  private detectPageSize(): number {
    try {
      const value = Number.parseInt(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim(), 10);
      if (Number.isInteger(value) && value > 0) {
        return value;
      }
      console.warn(`[MemorySampler] Unexpected "getconf PAGESIZE" output; using ${DEFAULT_PAGE_SIZE_BYTES} bytes.`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(
        `[MemorySampler] "getconf PAGESIZE" failed (${detail}); using ${DEFAULT_PAGE_SIZE_BYTES} bytes.`
      );
    }
    return DEFAULT_PAGE_SIZE_BYTES;
  }

  /** Returns the resident memory of `pid` in bytes, or 0 if the process no longer exists. */
  private readStatmRss(pid: number | 'self'): number {
    let statm: string;
    try {
      statm = fs.readFileSync(`/proc/${pid}/statm`, 'utf8');
    } catch (err) {
      if (isErrnoException(err) && (err.code === 'ENOENT' || err.code === 'ESRCH')) {
        return 0;
      }
      throw new Error(`Failed to read /proc/${pid}/statm`, { cause: err });
    }
    const residentPages = Number.parseInt(statm.trim().split(/\s+/)[1] ?? '', 10);
    if (!Number.isInteger(residentPages)) {
      throw new Error(`Unexpected /proc/${pid}/statm format: "${statm.trim()}"`);
    }
    return residentPages * this.pageSizeBytes;
  }

  public start(childPid?: number): void {
    if (childPid !== undefined) this.childPid = childPid;
    this.initialNodeRss = this.readStatmRss('self') || process.memoryUsage().rss;

    this.timer = setInterval(() => {
      try {
        this.sample();
      } catch (err) {
        // A timer callback cannot throw to the caller; keep the first error and rethrow in stop().
        this.samplingError ??= err instanceof Error ? err : new Error(String(err));
      }
    }, this.intervalMs);
  }

  public sample(): void {
    const nodeUsage = process.memoryUsage();
    const nodeRss = this.readStatmRss('self') || nodeUsage.rss;
    const childRss = this.childPid === null ? 0 : this.readStatmRss(this.childPid);
    const aggregateRss = nodeRss + childRss;

    this.peakAggregateRss = Math.max(this.peakAggregateRss, aggregateRss);
    this.peakNodeRss = Math.max(this.peakNodeRss, nodeRss);
    this.peakChildRss = Math.max(this.peakChildRss, childRss);
    this.peakHeapUsed = Math.max(this.peakHeapUsed, nodeUsage.heapUsed);
    this.peakExternal = Math.max(this.peakExternal, nodeUsage.external);
    this.peakArrayBuffers = Math.max(this.peakArrayBuffers, nodeUsage.arrayBuffers);
    this.sampleCount++;

    const snapshot: MemoryTickSnapshot = {
      aggregateRssMb: toMb(aggregateRss),
      nodeRssMb: toMb(nodeRss),
      childRssMb: toMb(childRss)
    };
    this.lastTickSnapshot = snapshot;

    if (
      !this.hardFailTriggered &&
      this.hardFailThresholdMb !== undefined &&
      snapshot.aggregateRssMb > this.hardFailThresholdMb
    ) {
      this.hardFailTriggered = true;
      this.onHardFailExceeded?.(snapshot);
    }
  }

  /** Stops sampling and returns peak statistics. Rethrows the first background sampling error. */
  public stop(): MemoryStatsResult {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.samplingError) {
      throw new Error('Memory sampling failed during the run', { cause: this.samplingError });
    }
    this.sample();
    this.finalNodeRss = this.readStatmRss('self') || process.memoryUsage().rss;

    return {
      peakAggregateRssMb: toMb(this.peakAggregateRss),
      peakNodeRssMb: toMb(this.peakNodeRss),
      peakChildRssMb: toMb(this.peakChildRss),
      peakHeapUsedMb: toMb(this.peakHeapUsed),
      peakExternalMb: toMb(this.peakExternal),
      peakArrayBuffersMb: toMb(this.peakArrayBuffers),
      initialNodeRssMb: toMb(this.initialNodeRss),
      finalNodeRssMb: toMb(this.finalNodeRss),
      pageSizeBytes: this.pageSizeBytes,
      sampleCount: this.sampleCount
    };
  }
}
