# Phase 1: Architectural Foundation & Zero-Browser Streaming Render Pipeline

> **Document Status**: Historical Specification & Architectural Foundation (Phase 1 Completed).  
> **Original Document**: `note.md` (translated into technical English for repository-wide English policy).

---

## 1. Project Context & Vision

We are building the **AI-Agent Animation Studio** from scratch in this workspace repository.

The ultimate goal is an automated CLI-driven studio where human input consists solely of a song audio file (`.flac` / `.mp3`) and time-stamped lyrics (`.lrc`). From this input, a pipeline of AI Agents and a Procedural Cinema Engine will produce a vibrant, cinematic 2.5D narrative animated music video (multi-angle camera cuts, 3D-to-2D perspective projection, dynamic character articulation, shape morphing, audio-reactive lighting and particle effects) and export it as an `.mp4` file (1920x1080 at 30 or 60 fps).

---

## 2. Environment Realities & Hard Architectural Constraints

Do not guess host specifications. The following WSL2 Ubuntu environment facts govern the architecture:

- **Workspace Path:** Workspace repository root (`.`)
- **CPU:** Intel Core Ultra 5 125H (14 cores / 18 threads).
- **WSL2 RAM:** Total 5.8 GiB, available ~3.3 GiB.
- **GPU in WSL2:** No `/dev/dri` device node available (hardware acceleration via VAAPI/QSV cannot be accessed inside WSL2; CPU encoding with `libx264` is required).
- **Installed Runtimes:** Node.js `v24.16.0`, npm `12.0.2`, Python `3.12.3` (`python3-venv` and `pip` available), FFmpeg `/usr/bin/ffmpeg` (with `libx264` and `librsvg`).

### Absolute Architectural Prohibitions
1. **NO Headless Browsers or Browser-Based Frameworks:** Do NOT use Chromium, Puppeteer, Playwright, Remotion, Motion Canvas, or Revideo. Running a browser would exhaust the constrained 3.3 GiB memory window in WSL2.
2. **NO Per-Frame Disk I/O:** Do NOT write tens of thousands of temporary image files (`.svg` or `.png`) to SSD disk while rendering. Use an **In-Memory Streaming Pipe** directly to FFmpeg `stdin`.
3. **Strict Memory Gate:** The aggregate memory consumption (Node.js runtime + FFmpeg encoder subprocess) must remain strictly below 400 MB aggregate RSS.

---

## 3. Scope of Phase 1

Before constructing the kinematic engine (Phase 2), audio analysis pipeline (Phase 3), and AI Agent orchestrators (Phase 4), Phase 1 establishes the workspace foundation, deterministic data contracts, and zero-browser streaming renderer:

### 1. Modular Directory Structure
Clean separation of responsibilities:
- `src/schemas/`: TypeScript contracts and Zod schemas bridging AI Agent outputs with the engine.
- `src/engine/`: 3D-to-2D camera mathematics, projection, near/far and viewport clipping, and SVG compositor.
- `src/renderer/`: In-memory SVG rasterization and backpressure-governed FFmpeg streaming pipeline.
- `src/agents/`: Workspace for LLM Agent orchestration in subsequent phases.
- `src/config/`: Render profiles, thread mapping, and path constants.
- `src/diagnostics/`: Memory sampler, profiler, artifact hygiene, and gate validators.
- `python/`: Isolated environment for offline audio ML tooling in future phases.
- `scripts/`: Conformance tests and smoke benchmarks.
- `tests/`: Automated unit and integration test suites.

### 2. Deterministic Data Contracts (`src/schemas/`)
Type-safe schemas defining four core pillars:
- `AudioAnalysisManifest`: Frame-level audio features (`rms`, relative RMS, multi-band energy, spectral flux, onset detections) and `.lrc` lyrics.
- `DirectorStoryboardContract`: Narrative acts (Acts 1, 2, 3) and cinematic shots (frame ranges, camera framing, movement, angles, focus, lighting palette, narrative actions).
- `AssetRigContract`: Planar 2.5D visual assets, parallax depth layers (Z coordinates), skeletal bone hierarchies, and morph targets.
- `FrameStateContract`: Single-frame state evaluated by the compositor at each frame index `f` (`0 <= f < totalFrames`).

### 3. Zero-Browser In-Memory Frame Streamer (`src/renderer/`)
High-performance rendering pipeline with bounded memory consumption:
- Generator produces SVG markup strings in memory for frame `f`.
- Native Node.js rasterizer via Rust-based `@resvg/resvg-js` converts SVG to raw 32-bit RGBA buffers entirely in memory without touching disk.
- Buffers are written sequentially to FFmpeg `stdin` with explicit backpressure handling (`drain` event) to prevent buffer accumulation.
- FFmpeg encodes via CPU `libx264` (`yuv420p`, BT.709 color matrix and primaries, limited TV range, faststart MP4 container).
- Output is written to a `.part.mp4` staging path and committed via atomic filesystem rename upon clean FFmpeg termination.

### 4. Phase 1 Verification Suites
- `conformance-render.ts`: Verifies pre-encoding pixel buffers, RGBA channel alignment, alpha blending, stream encoding, ffprobe BT.709 metadata, post-decode pixel tolerance, and zero residual disk artifacts.
- `benchmark-smoke.ts`: Evaluates warmup and 3 consecutive 150-frame iterations @ 1080p 30fps to prove median FPS >= 15, per-iteration and median RSS < 400 MB, and zero disk artifacts.
