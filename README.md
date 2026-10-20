# AI-Agent Animation Studio

Zero-browser in-memory procedural 2.5D animation rendering engine and automated music video generation studio.

---

## 1. Project Purpose & Vision

AI-Agent Animation Studio is an automated studio engineered to convert song audio (`.flac` / `.mp3`) and time-stamped lyrics (`.lrc`) into cinematic 2.5D narrative animated music videos. The system combines multi-agent LLM planning with a high-performance procedural cinema engine, producing multi-angle camera cuts, 3D-to-2D perspective projection, dynamic character articulation, shape morphing, and audio-reactive lighting—exported directly to H.264 MP4 (1920x1080 at 30 or 60 fps).

---

## 2. Current Project Status

- **Phase 1: Completed**
  - Modular directory architecture established.
  - Deterministic data contracts (`audio.contract`, `storyboard.contract`, `rig.contract`, `frame.contract`, and cross-contract `invariants`).
  - Zero-browser streaming render pipeline (`SvgBuilder` -> Rust `@resvg/resvg-js` -> FFmpeg `stdin` pipe -> atomic MP4 commit).
  - Bundled deterministic font system (DejaVu Sans) with zero system font dependencies.
  - Sutherland-Hodgman 3D near/far frustum clipping and Liang-Barsky 2D viewport clipping.
  - Strict SVG policy validator rejecting external URLs, script tags, event handlers, and entity declarations.
  - Conformance test (Gate B) and 3-run smoke benchmark (Gate C) verified.
- **Phase 2: Completed**
  - Procedural cinema director engine (`ShotSequencer` with DOLLY/TRACKING and circular ORBIT slerp interpolation; `CameraShakeSystem` trauma accumulation model).
  - 2.5D articulated character kinematics (Forward Kinematics tree traversal, joint clamping, parent-relative affine transform propagation).
  - Dynamic secondary spring motion solver governing passive attachments driven by audio onsets and inertial acceleration.
  - Piecewise Cubic Bézier shape morphing with strict $C^0$ continuity preservation and additive audio/keyframe blending.
  - Strict Painter's Algorithm depth-sorted scene compositor with camera-space pre-clip centroid depth keying ($z_c$), recursive large-primitive subdivision ($z = z_{\text{mean}}$), and outward CCW face winding.
  - Isolated boundary edge rendering eliminating polygon stroke priority clashes.
  - Continuous analytical impulse decay lighting pulses ($I(t) = I_{\text{peak}} \cdot e^{-\lambda \Delta t}$) and zero-filter radial gradient glows.
  - 4-shot Phase 2 cinema demo (`npm run demo:phase2`) verified at **27.39 FPS**, **334.49 MB** RSS, and bounded memory plateau.
- **Phase 3 & 4: Planned Only**
  - Offline audio signal analysis and stem separation (Phase 3).
  - Multi-agent director, rig, and compositor LLM orchestration (Phase 4).

For technical specifications, see:
- [Phase 1 Architecture Foundation](docs/phase-1-architecture.md)
- [Phase 2 Cinema & Compositor Architecture](docs/phase-2-architecture.md)

---

## 3. Hard Architectural Constraints

The studio is designed to operate within a WSL2 Ubuntu environment with approximately 3.3 GiB of available RAM and no hardware GPU access (`/dev/dri` absent). These physical realities impose the following non-negotiable architectural rules:

1. **Strictly Zero Browsers:**
   No browser engines or browser automation frameworks may be used (no Chromium, Puppeteer, Playwright, Remotion, Motion Canvas, or Revideo). Browser engines consume 1.5–3+ GiB of memory and destabilize the WSL2 environment.
2. **In-Memory Streaming Only (Zero Per-Frame Disk I/O):**
   Under no circumstances may individual frame image files (`.svg` or `.png`) be written to disk. The pipeline generates SVG strings in RAM, rasterizes them to raw 32-bit RGBA buffers in RAM, and pipes them directly to FFmpeg `stdin`.
3. **FFmpeg `stdin` Streaming with Backpressure:**
   Every frame write must wait for both the stream write callback and the `drain` event whenever the OS pipe buffer is saturated, preventing unbounded memory accumulation on the Node.js heap.
4. **CPU Encoding with `libx264`:**
   Because GPU acceleration is unavailable in WSL2, encoding is executed entirely on CPU using `libx264` with bounded thread allocations (`AUTO_FFMPEG_THREADS = 2`) and memory-saving encoder flags (`sliced-threads=1:rc-lookahead=0:ref=1:bframes=0`).
5. **Atomic Output Publishing:**
   FFmpeg writes directly to a temporary staging file (`.part.mp4`). Only upon clean termination (exit code 0) and contract validation is the file committed atomically to its final destination via `fs.renameSync`. On failure, the staging file is unlinked immediately.

---

## 4. Runtime Prerequisites

Ensure the following tools are installed on your host system:

- **Node.js:** Tested on `v24.16.0` (compatible with Node.js >= 20.0.0, NodeNext ESM modules enabled).
- **npm:** Tested on `12.0.2`.
- **Python:** Tested on `3.12.3` with `venv` and `pip` (reserved for Phase 3 offline audio processing).
- **FFmpeg & ffprobe:** Tested on `ffmpeg 6.1.1` with `libx264`, `scale` filter, and BT.709 color conversion capabilities. Verify with:
  ```bash
  ffmpeg -version
  ffprobe -version
  ```

---

## 5. Repository Structure

```
ai-agent-animation-studio/
├── .gitignore                     # Excludes node_modules, output videos, logs, venvs
├── README.md                      # Primary project documentation
├── package.json                   # NPM configuration, dependencies, and validation scripts
├── package-lock.json              # Exact pinned dependency lockfile
├── tsconfig.json                  # Strict TypeScript configuration (NodeNext, ES2022)
├── docs/
│   ├── phase-1-architecture.md    # Phase 1 specification and architectural notes
│   └── phase-2-architecture.md    # Phase 2 cinema, kinematics, morphing & compositor specification
├── python/
│   ├── README.md                  # Python offline ML audio analysis tooling guide
│   └── __init__.py                # Package root
├── scripts/
│   ├── conformance-render.ts      # Conformance test (Gate B: pixel, color, metadata validation)
│   ├── benchmark-smoke.ts         # Smoke benchmark (Gate C: 3 runs @ 1080p, memory/speed gate)
│   └── demo-phase2-cinema.ts      # Phase 2 multi-shot procedural cinema demo & plateau benchmark
├── src/
│   ├── agents/
│   │   ├── README.md              # AI agents overview
│   │   └── index.ts               # Placeholder for Phase 4 LLM orchestrators
│   ├── assets/
│   │   └── fonts/
│   │       ├── DejaVuSans.ttf     # Bundled deterministic font
│   │       └── LICENSE-DejaVu.txt # Official license for bundled DejaVu fonts
│   ├── config/
│   │   ├── fonts.ts               # Font path and font family constants
│   │   ├── paths.ts               # Project root and output directory resolution
│   │   └── render-config.ts       # Zod schemas, thread mapping, and x264 parameters
│   ├── demo/
│   │   └── phase2-cinema/
│   │       ├── audio-fixture.ts   # Deterministic 180-frame 120 BPM audio & lyric fixture
│   │       ├── choreography.ts    # Multi-shot entity tracks, poses, and morph bindings
│   │       ├── environment.ts     # 3D architectural prisms, ground floor, and isolated grid lines
│   │       ├── index.ts           # Barrel export for Phase 2 demo modules
│   │       ├── rigs.ts            # Procedural character, parallax, pipe, and particle rigs
│   │       └── storyboard.ts      # 3-act, 4-shot director storyboard contract
│   ├── diagnostics/
│   │   ├── artifact-hygiene.ts    # Recursive scanner detecting leaked .png/.svg files
│   │   ├── benchmark-gates.ts     # Memory, plateau, and performance gate evaluator
│   │   ├── ffprobe.ts             # Type-safe, shell-safe video metadata probing
│   │   ├── memory-sampler.ts      # Linux /proc/<pid>/statm RSS sampler
│   │   └── timing.ts              # Per-frame and aggregate profiler
│   ├── engine/
│   │   ├── camera/
│   │   │   ├── camera-3d.ts       # 3D camera coordinate basis, view matrix, and transforms
│   │   │   ├── clipping.ts        # Sutherland-Hodgman frustum & 1/z perspective viewport clipping
│   │   │   └── projection.ts      # 3D-to-2D screen projection and single-point visibility
│   │   ├── compositor/
│   │   │   ├── depth-sort.ts      # Pre-clip camera-space depth keys & recursive primitive splitting
│   │   │   ├── lighting.ts        # Lambertian shading & continuous impulse decay lighting pulses
│   │   │   ├── scene-compositor.ts # Painter's algorithm 2.5D scene compositor & budget tracker
│   │   │   ├── svg-builder.ts     # Type-safe SVG XML generator (paths, groups, gradients)
│   │   │   └── svg-policy-validator.ts # Security scanner enforcing zero scripts/external URLs
│   │   ├── director/
│   │   │   ├── camera-shake.ts    # Continuous impulse-decay trauma camera shake system
│   │   │   ├── choreography.ts    # Entity track interpolation and audio-reactive morph evaluation
│   │   │   ├── frame-state-builder.ts # Deterministic FrameStateContract orchestrator
│   │   │   └── shot-sequencer.ts  # O(log N) shot lookup, DOLLY/TRACKING, and circular ORBIT slerp
│   │   ├── effects/
│   │   │   └── particles.ts       # Stateless analytical particle emitter & burst evaluator
│   │   ├── math/
│   │   │   ├── color.ts           # Deterministic RGB/Hex conversion, mixing, and shading
│   │   │   ├── easing.ts          # Camera & pose easing functions and Hermite spline interpolation
│   │   │   ├── index.ts           # Barrel export for engine math modules
│   │   │   ├── noise.ts           # Seeded 1D value noise and FNV-1a deterministic PRNG
│   │   │   └── spring.ts          # Analytical damped harmonic oscillator & exponential decay solver
│   │   └── rigging/
│   │       ├── billboard.ts       # Billboard similarity transform & world-plane 3D projection
│   │       ├── deformer.ts        # Pose track sampler, secondary spring solver & part deformer
│   │       ├── kinematics.ts      # Planar Forward Kinematics (FK) solver with joint clamping
│   │       └── morpher.ts         # Piecewise Cubic Bezier shape morpher & SVG path converter
│   ├── renderer/
│   │   ├── ffmpeg-streamer.ts     # ChildProcess streamer with backpressure and abort handling
│   │   ├── pipeline.ts            # High-level SVG -> Resvg -> FFmpeg streaming pipeline
│   │   └── rasterizer.ts          # Resvg native in-memory rasterizer
│   └── schemas/
│       ├── audio.contract.ts      # Audio analysis manifest and feature reader contracts
│       ├── choreography.contract.ts # Per-shot entity tracks, poses, and morph bindings schema
│       ├── frame.contract.ts      # Per-frame rendering state schema
│       ├── index.ts               # Central export for all schemas
│       ├── invariants.ts          # Cross-contract validation and continuity verification
│       ├── primitives.schema.ts   # Vec2, Vec3, Color, CameraTransform, and FrameRange
│       ├── rig.contract.ts        # Planar 2.5D asset rigs, skeletons, parts, and morph targets
│       └── storyboard.contract.ts # Director storyboards, acts, and cinematic shots
└── tests/
    ├── backpressure.test.ts       # Streamer backpressure, drain, and EPIPE recovery
    ├── benchmark-gates.test.ts    # Memory gate, plateau check, and artifact hygiene tests
    ├── clipping.test.ts           # Near/far frustum, 1/z depth, and canonical cube culling tests
    ├── demo-phase2.test.ts        # Phase 2 demo contracts, 180-frame budget, and determinism tests
    ├── depth-sort.test.ts         # Pre-clip depth keys, primitive splitting, and sort order tests
    ├── effects-director.test.ts   # Particle emitter, choreography, and FrameStateBuilder tests
    ├── font-rasterizer.test.ts    # Deterministic font rasterization tests
    ├── invariants.test.ts         # Storyboard timeline, act, rig, and choreography invariants
    ├── math.test.ts               # Easing, spring physics, noise, and color math tests
    ├── pipeline-lifecycle.test.ts # Atomic commit, abort, and error lifecycle tests
    ├── rigging.test.ts            # FK chain, joint clamping, Bezier morphing, and billboard tests
    ├── scene-compositor.test.ts   # Painter's algorithm, cube culling, pulse decay, and lyric fade
    ├── schemas.test.ts            # Schema parsing and Zod 4 JSON Schema export tests
    ├── shot-sequencer.test.ts     # Shot lookup, ORBIT slerp, and trauma camera shake tests
    └── svg-builder.test.ts        # Path commands, gradients, group nesting, and XML escaping tests
```

---

## 6. Installation & Setup

1. Clone or navigate to the workspace directory:
   ```bash
   git clone https://github.com/WageFolabessy/ai-agent-animation-studio.git
   cd ai-agent-animation-studio
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Verify TypeScript typechecking:
   ```bash
   npm run typecheck
   ```

---

## 7. Available npm Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `typecheck` | `tsc --noEmit` | Strict static typecheck without emitting JavaScript |
| `test` | `tsx --test tests/**/*.test.ts` | Runs the full automated test suite (99 tests) |
| `test:schemas` | `tsx --test tests/schemas.test.ts` | Tests primitive schemas and Zod 4 contracts |
| `test:invariants` | `tsx --test tests/invariants.test.ts` | Tests cross-contract timeline, skeleton, and choreography invariants |
| `test:backpressure`| `tsx --test tests/backpressure.test.ts` | Tests FFmpeg streamer backpressure and lifecycle |
| `test:conformance` | `tsx scripts/conformance-render.ts` | Executes conformance render Gate B verification |
| `test:benchmark:smoke` | `NODE_OPTIONS="--expose-gc" tsx scripts/benchmark-smoke.ts` | Executes 3-run 1080p smoke benchmark Gate C |
| `demo:phase2` | `NODE_OPTIONS="--expose-gc" tsx scripts/demo-phase2-cinema.ts` | Executes full 4-shot Phase 2 cinema demo & benchmark |

---

## 8. How to Run Verification Suites

### 1. Static Typecheck
```bash
npm run typecheck
```

### 2. Automated Unit and Integration Tests
```bash
npm test
```

### 3. Conformance Test (Gate B)
Renders a 4-frame RGBA test video, verifies channel order (Red, Green, Blue, Alpha), inspects BT.709 metadata via ffprobe, decodes the resulting stream to verify color tolerance, and confirms zero leftover disk files:
```bash
npm run test:conformance
```

### 4. Smoke Benchmark (Gate C)
Executes a 30-frame warm-up followed by three 150-frame iterations (5.0s @ 1080p 30fps) and a 450-frame plateau run with procedural 3D camera rotation, depth-sorted parallax stars, recursively subdivided perspective grid (`splitLargeLine`), rotating 3D cube with outward CCW normal culling, opaque face fills (`opacity=1.0`, `stroke="none"`), isolated deduplicated wireframe edge paths (`CUBE_EDGES`), and continuous exponential-decay audio-reactive HUD:
```bash
npm run test:benchmark:smoke
```

---

## 9. Data Contract Overview

The studio uses strongly typed Zod schemas to guarantee consistency between planned director decisions and the low-level rendering engine:

1. **Audio Analysis Manifest (`audio.contract.ts`):**  
   Defines frame-level audio metrics (`rms`, relative RMS, multi-band energy: subBass, bass, lowMid, mid, highMid, presence, brilliance, and onset events) alongside parsed time-stamped lyrics. Frame features can be queried via an O(1) `AudioFeatureReader`.
2. **Director Storyboard (`storyboard.contract.ts`):**  
   Encapsulates narrative structure into three contiguous acts (`acts`) and cinematic shots (`shots`). Each shot defines camera transitions, movement types, viewpoints, depth-of-field blur, color lighting palettes, and active asset rig references.
3. **Asset Rig (`rig.contract.ts`):**  
   Specifies 2.5D visual assets (`character`, `prop`, `background_parallax`, `particle_emitter`), render modes (`billboard` or `world_plane`), single-source-of-truth 3D base transforms (`baseTransform.position[2]`), planar skeletal bone joints with angle constraints, procedural geometry parts (`rect`, `circle`, `ellipse`, `polygon`, `bezier_path`, `morphed_path` with $C^0$ continuous morph targets), secondary spring attachments, and stateless particle emitter specs.
4. **Choreography (`choreography.contract.ts`):**  
   Defines per-shot entity placement tracks (`transformTrack`), pose selectors (`poseId`), keyframe overrides, and audio-reactive/keyframed morph bindings (`morphBindings`).
5. **Frame State (`frame.contract.ts`):**  
   The atomic state contract passed to the compositor at frame `f`, combining interpolated camera positions, lighting palettes, active lyric status, and articulated character entities (`jointAngles`, `jointOffsets`, `morphWeights`).
6. **Contract Invariants (`invariants.ts`):**  
   Enforces cross-contract invariants:
   - Storyboard, audio, and render config frame counts and frame rates must match identically.
   - Audio `durationSeconds * fps` must match `totalFrames` within +/- 1 frame.
   - Act 1 must start at frame 0, acts must be contiguous, and Act 3 must end at `totalFrames`.
   - The first shot must start at frame 0 and the last shot must end at `totalFrames`.
   - `cameraStart.projectionMode` and `cameraEnd.projectionMode` must match within every shot.
   - Skeletal joint trees must contain exactly 1 root and have zero dependency cycles; all parts, secondary motion chains, and pose tracks must reference valid joints with strictly increasing frame numbers.
   - Piecewise Cubic Bezier morph bases and deltas must maintain strict $C^0$ continuity across segment boundaries.

---

## 10. Rendering Pipeline Architecture

```
[Frame Index f]
       │
       ▼
[SvgBuilder / Compositor] ─────────► [svg-policy-validator]
       │                                     │ (Reject scripts / external URLs)
       ▼ (In-Memory SVG String)              ▼
[SvgRasterizer (@resvg/resvg-js)] ──► [DejaVuSans.ttf (Bundled Font)]
       │
       ▼ (Raw 32-bit RGBA Buffer)
[FfmpegStreamer] ──────────────────► [FFmpeg child_process stdin]
       │ (Backpressure / drain)              │
       │                                     ▼ (H.264 / BT.709 / yuv420p)
       │                              [output/.part.mp4 (Staging)]
       ▼ (Stream complete & code 0)          │
[Atomic Commit (fs.renameSync)] ◄────────────┘
       │
       ▼
[output/<name>.mp4 (Final Published Video)]
```

---

## 11. Memory and Performance Gates

Every production build and smoke benchmark must satisfy these quantitative gates:

- **Memory Gates (Target & Hard Limits):**  
  - Target: Aggregate memory (Node.js RSS + FFmpeg child RSS) should remain <= **400 MB**.
  - Hard Fail: Aggregate memory must strictly not exceed **600 MB** for any iteration.
  - Memory Plateau: Long-run memory growth (e.g. 540 frames vs 180 frames) must not exceed `max(32 MB, 10% of short run)`, preventing unbounded memory leaks.
- **Rendering Throughput:**  
  Median effective rendering speed must be at least **15 FPS** (measured **21.39 FPS** in Phase 2 demo, **40.16 FPS** in smoke benchmark).
- **Color Space Conformance:**  
  Encoded video must strictly carry standard BT.709 television metadata:
  - `color_space=bt709`
  - `color_primaries=bt709`
  - `color_transfer=bt709`
  - `color_range=tv`
- **Zero Process Leaks:**  
  No orphaned FFmpeg child processes may remain running after either successful render completion or caught pipeline exceptions.

### Measured Phase 2 Demo Benchmark Numbers

| Metric | Target / Gate Limit | Measured Value | Result |
| :--- | :--- | :--- | :--- |
| **Median Effective FPS** | $\ge 15.00\text{ FPS}$ | **21.39 FPS** | **PASS** |
| **Median Peak Aggregate RSS** | $< 400\text{ MB}$ (Target) | **314.25 MB** (Node: 184 MB, FFmpeg: 130 MB) | **PASS (Green)** |
| **Memory Plateau Growth** | $\le 32.00\text{ MB}$ | **$+12.02\text{ MB}$** ($180\text{f}: 314.25 \to 540\text{f}: 326.27\text{ MB}$) | **PASS** |
| **Drawables per Frame** | $\le 220$ | **103 peak** | **PASS** |
| **Gradient Shapes per Frame** | $\le 100$ | **22 peak** | **PASS** |
| **Live Particles per Frame** | $\le 150$ | **35 peak** | **PASS** |
| **Filters / Masks** | $0$ | **0** | **PASS** |

---

## 12. Output and Artifact Hygiene Rules

- The `output/` directory is git-ignored and holds only final committed `.mp4` video files.
- Staging files (`.part.mp4`) are strictly temporary and unlinked on failure or renamed on success.
- **Zero Temporary Frame Images:** No `.svg` or `.png` frame files may ever be written to disk. This is continuously verified by `tests/benchmark-gates.test.ts` using `findTemporaryImageFiles()`.

---

## 13. Development Guidelines

- **English Language Convention:** All project-owned source code, comments, filenames, folders, documentation, tests, configuration, diagnostics, and user-facing messages are written in English by project convention.
- **Strict TypeScript:** No implicit `any`, no untyped casts, and no bypass assertions unless strictly justified.
- **ESM NodeNext Imports:** All internal module imports must include the explicit `.js` extension (e.g. `import { SvgRasterizer } from './rasterizer.js';`).
- **Standard Node Built-in Prefixes:** Always use `node:` imports (e.g. `node:fs`, `node:path`, `node:child_process`, `node:assert/strict`).
- **Deterministic Resolution:** Use `PROJECT_ROOT` and `OUTPUT_DIR` from `src/config/paths.ts` instead of assuming the current working directory.
- **Actionable Errors:** Never silently swallow exceptions in empty `catch {}` blocks. Include diagnostic context in thrown errors.

---

## 14. Testing Guidelines

- All tests reside in `tests/` and execute via the native Node.js test runner (`tsx --test`).
- Tests must be completely deterministic, self-contained, and must not depend on external network connectivity or operating system font installations.
- Use `createTestRenderConfig()` when testing low resolutions to avoid invalidating the production 1080p schema.

---

## 15. Security Considerations

- **Zero Shell Command Construction:**  
  All subprocess invocations (`spawn`, `execFileSync`) pass arguments as strongly typed string arrays. No shell string interpolation is permitted.
- **Pre-Rasterization SVG Policy Validation:**  
  Every SVG string is scanned before entering `@resvg/resvg-js`. Any `<script>`, event handler (`onload`, `onclick`), external resource reference (`href="http..."`, `xlink:href="https..."`), or `<!DOCTYPE`/`<!ENTITY` declaration triggers an immediate validation error.
- **Path Traversal Resistance:**  
  All output video paths are resolved with `path.resolve()` and validated to ensure they carry a valid `.mp4` extension.
- **Air-Gapped Operation:**  
  The engine contains zero network callers, analytics, or telemetry.

---

## 16. Roadmap

- **Phase 1 (Completed):**  
  Zero-browser streaming rendering pipeline, data contracts, camera clipping mathematics, deterministic typography, and memory/performance benchmark gates.
- **Phase 2 (Completed):**  
  Procedural cinema director (`ShotSequencer`, DOLLY/TRACKING/ORBIT, trauma camera shake), 2.5D articulated character rigging (FK, joint limits, secondary spring motion), shape morphing with $C^0$ continuity, strict Painter's algorithm depth sorting, and audio-reactive scene compositor.
- **Phase 3 (Planned):**  
  Offline audio signal feature extraction (RMS envelopes, spectral flux, transient detection, beat tracking) and automated lyric alignment.
- **Phase 4 (Planned):**  
  Multi-agent LLM orchestration: Director Agent (screenplay and shot division), Rig Agent (character design), and Compositor Agent (audio-reactive effects).

---

## 17. License

This repository is private. No open-source license has been declared.
The bundled DejaVu Sans font is distributed under its own license; see
[src/assets/fonts/LICENSE-DejaVu.txt](src/assets/fonts/LICENSE-DejaVu.txt).

