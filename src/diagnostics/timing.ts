export interface FrameTimingRecord {
  frameIndex: number;
  genMs: number;
  rasterMs: number;
  writeMs: number;
  totalFrameMs: number;
}

export interface TimingStats {
  frameCount: number;
  totalWallMs: number;
  effectiveFps: number;
  avgGenMs: number;
  p95GenMs: number;
  avgRasterMs: number;
  p95RasterMs: number;
  avgWriteMs: number;
  p95WriteMs: number;
  avgFrameMs: number;
  p95FrameMs: number;
}

export class TimingProfiler {
  private records: FrameTimingRecord[] = [];
  private startWall = 0;
  private endWall = 0;

  public start(): void {
    this.startWall = performance.now();
  }

  public recordFrame(frameIndex: number, genMs: number, rasterMs: number, writeMs: number): void {
    this.records.push({
      frameIndex,
      genMs,
      rasterMs,
      writeMs,
      totalFrameMs: genMs + rasterMs + writeMs
    });
  }

  public stop(): TimingStats {
    this.endWall = performance.now();
    const totalWallMs = this.endWall - this.startWall;
    const n = this.records.length;
    if (n === 0) {
      return {
        frameCount: 0,
        totalWallMs,
        effectiveFps: 0,
        avgGenMs: 0,
        p95GenMs: 0,
        avgRasterMs: 0,
        p95RasterMs: 0,
        avgWriteMs: 0,
        p95WriteMs: 0,
        avgFrameMs: 0,
        p95FrameMs: 0
      };
    }

    const calcP95 = (arr: number[]) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);
      return sorted[idx];
    };

    const genArr = this.records.map((r) => r.genMs);
    const rasterArr = this.records.map((r) => r.rasterMs);
    const writeArr = this.records.map((r) => r.writeMs);
    const frameArr = this.records.map((r) => r.totalFrameMs);

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    return {
      frameCount: n,
      totalWallMs,
      effectiveFps: n / (totalWallMs / 1000),
      avgGenMs: sum(genArr) / n,
      p95GenMs: calcP95(genArr),
      avgRasterMs: sum(rasterArr) / n,
      p95RasterMs: calcP95(rasterArr),
      avgWriteMs: sum(writeArr) / n,
      p95WriteMs: calcP95(writeArr),
      avgFrameMs: sum(frameArr) / n,
      p95FrameMs: calcP95(frameArr)
    };
  }
}
