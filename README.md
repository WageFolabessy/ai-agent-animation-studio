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
  - 4-shot Phase 2 cinema demo (`npm run demo:phase2`) verified at **21.39 FPS**, **314.25 MB** RSS, and bounded memory plateau.
- **Phase 3: Completed**
  - Offline multi-band STFT audio intelligence (7 acoustic frequency bands, global & 3.0s rolling local RMS, half-wave rectified spectral flux, onset detection, and beat event extraction) in both TypeScript (`src/engine/audio/wav-analyzer.ts`) and Python (`python/analyze_audio.py`).
  - Compact binary columnar format (`.features.bin`, `columnLayoutVersion: 1`, `32 + 53 * N` bytes = `572 KB` for a 6-minute song @ 30fps) and $O(1)$ `ColumnarAudioFeatureReader` with SHA-256 verification and 4-byte `Buffer` alignment guard.
  - Deterministic `.lrc` parser (`src/engine/audio/lrc-parser.ts`) with metadata stripping, multi-timestamp chorus expansion, empty-timestamp instrumental cutoff truncation, and $O(\log L)$ binary search in `FrameStateBuilder`.
  - Direct FFmpeg audio-video muxing (`-map 0:v:0 -map 1:a:0 -c:a aac -shortest`) and dual-stream `ffprobe` validation (`npm run demo:phase3` verified at **19.30 FPS**, **329.61 MB** RSS, and **+1.39 MB** plateau growth).
- **Phase 4 & 4.5: Completed**
  - Provider-agnostic `LlmProvider` (`OpenAiCompatibleProvider` + offline `DeterministicMockLlmProvider`) and `extractJsonFromLlmResponse` markdown/BOM sanitizer.
  - Multi-agent orchestration: `DirectorAgent` (`src/agents/director-agent.ts`), `RigAgent` (`src/agents/rig-agent.ts`), `ChoreographerAgent` (`src/agents/choreographer-agent.ts`), and `StudioAgentOrchestrator` (`src/agents/orchestrator.ts`).
  - Embedded Zod 4 `draft-07` JSON Schemas in all agent system prompts for zero-shot real LLM conformance.
  - Stateless closed-loop self-healing retry pipeline with `[PREVIOUS FAILED JSON DRAFT]` retention and diagnostics feedback across schema (`LlmSchemaValidationError`) and invariant failures.
  - Kinematic smoothing and visual polish: periodic Hermite spline tangent unwrapping, stride phase continuity across camera cuts, seamless neck (`neck_collar`) and waist (`abdomen_core`) connectors on close-ups, elimination of floating double-offsets on coat wings/ribbons (`PART_DETACHED_FROM_JOINT_PIVOT`), and near-plane clipping prevention for foreground gantries (`FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE`).
- **Phase 5: Completed**
  - Production-grade full-song music video generator (`scripts/produce-music-video.ts`, `npm run produce:video`) rendering up to 10,598 frames (~6.0 minutes @ 30 FPS) with single-line interactive ASCII progress telemetry (`\r`).
  - Chunked streaming rendering pipeline (`src/engine/director/chunk-renderer.ts`) and fault-tolerant checkpoint manager (`src/engine/director/checkpoint-manager.ts`) supporting deep `ffprobe` inspection, automated corrupted-chunk purging, and zero-overhead instant resume (`--resume`).
  - Sub-second lossless assembly via FFmpeg Concat Demuxer (`src/engine/audio/concat-stitcher.ts`) with continuous uncompressed master FLAC $\to$ AAC 256kbps stereo audio muxing (`-c:v copy -c:a aac -shortest`).
  - Hierarchical macro-to-micro storyboard planner (`src/engine/director/macro-planner.ts`) decomposing full songs into 7 musical sections with 5 dynamic thematic palettes (`CYBERPUNK_CYAN`, `VOLTAGE_ORANGE`, `SUNSET_GOLD`, `CRIMSON_FURY`, `MIDNIGHT_VOID`).
  - Secondary articulated pursuit enforcer drone rig (`CANONICAL_RIG_IDS.PURSUIT_DRONE`) with 4-joint FK thrusters and dynamic flight tracking.

For technical specifications, see:
- [Phase 1 Architecture Foundation](docs/phase-1-architecture.md)
- [Phase 2 Cinema & Compositor Architecture](docs/phase-2-architecture.md)
- [Phase 3 Audio Intelligence, LRC & Muxing Architecture](docs/phase-3-architecture.md)
- [Phase 4 Multi-Agent LLM Orchestration Architecture](docs/phase-4-architecture.md)
- [Phase 5 Production Video Architecture](docs/phase-5-architecture.md)

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
├── assets/
│   └── audio/
│       ├── trashed-and-scattered.flac # Avenged Sevenfold reference audio (FLAC)
│       └── trashed-and-scattered.lrc  # Aligned timestamped lyrics
├── docs/
│   ├── phase-1-architecture.md    # Phase 1 streaming renderer foundation
│   ├── phase-2-architecture.md    # Phase 2 cinema, kinematics, morphing & compositor
│   ├── phase-3-architecture.md    # Phase 3 audio intelligence, columnar binary & AAC muxing
│   └── phase-4-architecture.md    # Phase 4 multi-agent LLM orchestration architecture
├── python/
│   ├── README.md                  # Python offline ML audio analysis tooling guide
│   ├── __init__.py                # Python package root
│   ├── analyze_audio.py           # Offline STFT 7-band feature extraction & binary exporter
│   └── requirements.txt           # Python dependencies (numpy, scipy, soundfile)
├── scripts/
│   ├── conformance-render.ts      # Conformance test (Gate B: pixel, color, metadata validation)
│   ├── benchmark-smoke.ts         # Smoke benchmark (Gate C: 3 runs @ 1080p, memory/speed gate)
│   ├── demo-phase2-cinema.ts      # Phase 2 multi-shot procedural cinema demo & plateau benchmark
│   ├── demo-phase3-audio.ts       # Phase 3 audio intelligence, LRC alignment & AAC muxing demo
│   └── demo-phase4-orchestration.ts # Phase 4 multi-agent orchestration cinema demo & benchmark
├── src/
│   ├── agents/
│   │   ├── README.md              # AI agents overview
│   │   ├── choreographer-agent.ts # Choreographer Agent: entity tracks, poses, and morph bindings
│   │   ├── director-agent.ts      # Director Agent: acts, shots, camera moves, and JSON schema
│   │   ├── index.ts               # Barrel export for agents and orchestration modules
│   │   ├── llm-provider.ts        # OpenAiCompatibleProvider, DeterministicMockLlmProvider & draft retention
│   │   ├── orchestrator.ts        # StudioAgentOrchestrator: closed-loop self-healing repair loop
│   │   ├── rig-agent.ts           # Rig Agent: asset & character rigs, knee constraints, and connectors
│   │   └── types.ts               # LlmProvider, LlmOptions, OrchestrationResult, and AgentInput interfaces
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
│   │       ├── audio-manifest.ts  # Deterministic 180-frame 120 BPM audio & lyric fixture
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
│   │   ├── audio/
│   │   │   ├── columnar-format.ts # Binary columnar encoder/decoder (32 + 53 * N bytes)
│   │   │   ├── feature-reader.ts  # O(1) ColumnarAudioFeatureReader with 4-byte buffer alignment guard
│   │   │   ├── index.ts           # Audio engine barrel export
│   │   │   ├── lrc-parser.ts      # Deterministic LRC lyric parser & acoustic emphasis aligner
│   │   │   ├── python-bridge.ts   # Subprocess bridge to python/analyze_audio.py
│   │   │   └── wav-analyzer.ts    # Pure TypeScript offline 7-band STFT audio analyzer
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
│   │   │   └── particle-emitter.ts # Stateless analytical particle emitter & burst evaluator
│   │   ├── math/
│   │   │   ├── color.ts           # Deterministic RGB/Hex conversion, mixing, and shading
│   │   │   ├── easing.ts          # Camera & pose easing functions and Hermite spline interpolation
│   │   │   ├── index.ts           # Barrel export for engine math modules
│   │   │   ├── noise.ts           # Seeded 1D value noise and FNV-1a deterministic PRNG
│   │   │   └── spring.ts          # Analytical damped harmonic oscillator & exponential decay solver
│   │   └── rigging/
│   │       ├── deformer.ts        # Pose track sampler, secondary spring solver & part deformer
│   │       ├── kinematics.ts      # Planar Forward Kinematics (FK) solver with joint clamping & billboard projection
│   │       └── morpher.ts         # Piecewise Cubic Bezier shape morpher & SVG path converter
│   ├── renderer/
│   │   ├── ffmpeg-streamer.ts     # ChildProcess streamer with backpressure, abort handling & AAC muxing
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
    ├── agents-orchestrator.test.ts # Multi-agent orchestration, self-healing retries & visual invariants
    ├── audio-columnar.test.ts     # .features.bin binary layout, alignment guard & O(1) reader tests
    ├── audio-mux.test.ts          # Dual-stream FFmpeg video + AAC audio muxing & Python bridge tests
    ├── audio-parity.test.ts       # Sub-frame parabolic tempo estimation and TS vs Python parity tests
    ├── backpressure.test.ts       # Streamer backpressure, drain, and EPIPE recovery
    ├── benchmark-gates.test.ts    # Memory gate, plateau check, and artifact hygiene tests
    ├── clipping.test.ts           # Near/far frustum, 1/z depth, and canonical cube culling tests
    ├── demo-phase2.test.ts        # Cinema demo contracts, 180-frame budget, and determinism tests
    ├── depth-order.test.ts        # LayerPass priority and ground vs character depth ordering tests
    ├── depth-sort.test.ts         # Pre-clip depth keys, primitive splitting, and sort order tests
    ├── emitter-saturation.test.ts # FIFO ring-buffer particle emitter saturation and audio burst retention
    ├── font-rasterizer.test.ts    # Deterministic font rasterization tests
    ├── frame-state.test.ts        # Particle emitter, choreography, and FrameStateBuilder tests
    ├── invariants.test.ts         # Storyboard timeline, act, rig, and choreography invariants
    ├── library-kits.test.ts       # Modular archetype factory and environment kit generation tests
    ├── llm-resilience.test.ts     # Error taxonomy, exponential backoff, truncation detection & repair tests
    ├── lrc-parser.test.ts         # Deterministic LRC parser, multi-timestamp expansion & emphasis tests
    ├── math.test.ts               # Easing, spring physics, noise, and color math tests
    ├── pipeline-lifecycle.test.ts # Atomic commit, abort, and error lifecycle tests
    ├── rigging.test.ts            # FK chain, joint clamping, Bezier morphing, and billboard tests
    ├── scene-compositor.test.ts   # Painter's algorithm, cube culling, pulse decay, and lyric fade
    ├── schemas.test.ts            # Schema parsing and Zod 4 JSON Schema export tests
    ├── shot-sequencer.test.ts     # Shot lookup, ORBIT slerp, and trauma camera shake tests
    ├── story-spec.test.ts         # Spec-Then-Compile story synthesis, beat snapping & solver tests
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
| `test` | `tsx --test tests/**/*.test.ts` | Runs the full automated test suite (174 tests across 25 suites) |
| `test:schemas` | `tsx --test tests/schemas.test.ts` | Tests primitive schemas and Zod 4 contracts |
| `test:invariants` | `tsx --test tests/invariants.test.ts` | Tests cross-contract timeline, skeleton, and choreography invariants |
| `test:backpressure`| `tsx --test tests/backpressure.test.ts` | Tests FFmpeg streamer backpressure and lifecycle |
| `test:conformance` | `tsx scripts/conformance-render.ts` | Executes conformance render Gate B verification |
| `test:benchmark:smoke` | `NODE_OPTIONS="--expose-gc" tsx scripts/benchmark-smoke.ts` | Executes 3-run 1080p smoke benchmark Gate C |
| `demo:phase2` | `NODE_OPTIONS="--expose-gc" tsx scripts/demo-phase2-cinema.ts` | Executes full 4-shot Phase 2 cinema demo & benchmark |
| `demo:phase3` | `NODE_OPTIONS="--expose-gc" tsx scripts/demo-phase3-audio.ts` | Executes Phase 3 STFT audio intelligence, LRC alignment & AAC muxing demo |
| `demo:phase4` | `NODE_OPTIONS="--expose-gc" tsx scripts/demo-phase4-orchestration.ts` | Executes Phase 4 Multi-Agent LLM Orchestration & self-healing cinema demo |
| `produce:video` | `NODE_OPTIONS="--expose-gc" tsx scripts/produce-music-video.ts` | Executes production full-length music video pipeline |
| `studio` | `NODE_OPTIONS="--expose-gc" tsx scripts/studio.ts` | Unified autonomous music video studio CLI (Spec-Then-Compile, persistence & resume) |

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

### 5. Phase 2 Procedural Cinema Demo
Executes the 4-shot procedural cinema sequence (`DOLLY`, `TRACKING`, `ORBIT`, `CLOSE_UP` with Dutch roll and trauma camera shake) with 540-frame plateau benchmark:
```bash
npm run demo:phase2
```

### 6. Phase 3 Audio Intelligence & AAC Muxing Demo
Executes 7-band STFT audio analysis, columnar `.features.bin` encoding, deterministic `.lrc` alignment, and dual-stream H.264 + AAC audio-video muxing using either synthesized musical WAV or real song audio:
```bash
npm run demo:phase3
```

### 7. Phase 4 Multi-Agent LLM Orchestration Demo
Executes the complete autonomous multi-agent pipeline (`DirectorAgent` $\to$ `RigAgent` $\to$ `ChoreographerAgent` $\to$ `StudioAgentOrchestrator`) with automated self-healing repair loops:
```bash
# Default deterministic mock mode (100% offline, reproducible):
npm run demo:phase4

# Real OpenAI / OpenAI-compatible endpoint (e.g. Gemini, Ollama, Groq):
export LLM_API_KEY="your-api-key"
npm run demo:phase4 -- --provider openai

# Custom audio/lrc slice with custom duration and output name:
npm run demo:phase4 -- --audio "assets/audio/trashed-and-scattered.flac" --lrc "assets/audio/trashed-and-scattered.lrc" --start 49.0 --duration 6.0 --out "my_cinema.mp4"
```

### 8. Phase 5 Full-Length Music Video Production
Executes the production pipeline across full-length songs (~6 minutes / 10,598 frames) using chunked streaming, fault-tolerant checkpointing, and lossless FFmpeg concat stitching:
```bash
# Full-length production of Trashed And Scattered (default 1500f chunks, continuous AAC master audio):
npm run produce:video

# Custom chunk sizing and automated instant resume:
npm run produce:video -- --chunk-frames 1500 --resume

# Quick multi-chunk test run (e.g. 2 chunks of 60 frames):
npm run produce:video -- --chunk-frames 60 --max-chunks 2 --out test_slice.mp4
```

### 9. Unified Studio Production CLI (`npm run studio`)
The unified studio production CLI provides a single command line interface for song-driven video generation. It supports custom songs (`.flac`, `.wav`, `.mp3`), LRC lyric alignment, Spec-Then-Compile narrative orchestration, artifact persistence, and instant resume:
```bash
# Display CLI help and options:
npm run studio -- --help

# Run with custom audio and synchronized lyrics:
npm run studio -- --audio path/to/song.flac --lrc path/to/song.lrc --out output/final_render.mp4

# Run with real OpenAI LLM provider:
export LLM_API_KEY="sk-..."
npm run studio -- --audio path/to/song.flac --lrc path/to/song.lrc --provider openai

# Render from previously persisted artifacts (skipping LLM orchestration):
npm run studio -- --from-artifacts output/artifacts/<hash> --out output/rerender.mp4

# Quick short preview:
npm run studio -- --chunk-frames 60 --max-chunks 1 --out output/preview.mp4
```

---

## 9. Data Contract Overview

The studio uses strongly typed Zod schemas to guarantee consistency between planned director decisions and the low-level rendering engine:

1. **Audio Analysis Manifest (`audio.contract.ts`):**  
   Defines frame-level audio metrics (`rms`, relative RMS, multi-band energy: `subBass`, `bass`, `lowMid`, `mid`, `highMid`, `presence`, `brilliance`, and onset events) alongside parsed time-stamped lyrics. Frame features are serialized into a binary columnar `.features.bin` file (`columnLayoutVersion: 1`, `32 + 53 * N` bytes) and queried in $O(1)$ time via `ColumnarAudioFeatureReader` with a 4-byte buffer alignment guard.
2. **Director Storyboard (`storyboard.contract.ts`):**  
   Encapsulates narrative structure into three contiguous acts (`acts`) and cinematic shots (`shots`). Each shot defines camera transitions, movement types (`DOLLY`, `TRACKING`, `ORBIT`, `STATIC`), viewpoints, depth-of-field blur, color lighting palettes, and active asset rig references.
3. **Asset Rig (`rig.contract.ts`):**  
   Specifies 2.5D visual assets (`character`, `prop`, `parallax_background`, `parallax_midground`, `parallax_foreground`, `particle_emitter`), render modes (`billboard` or `planar`), single-source-of-truth 3D base transforms, planar skeletal bone joints with angle constraints, procedural geometry parts (`rect` with `rx`/`ry` rounded capsules, `circle`, `ellipse`, `polygon`, `path`, `morph` with $C^0$ continuous morph targets), secondary spring attachments, and stateless particle emitter specs.
4. **Choreography (`choreography.contract.ts`):**  
   Defines per-shot entity placement tracks (`transformTrack`), pose selectors, inter-shot stride phase handoff (`pose.startPoseFrame`), keyframe overrides, and audio-reactive/keyframed morph bindings (`morphBindings`).
5. **Frame State (`frame.contract.ts`):**  
   The atomic state contract passed to the compositor at frame `f`, combining interpolated camera positions, lighting palettes, active lyric status, and articulated character entities (`jointAngles`, `jointOffsets`, `morphWeights`).
6. **Contract Invariants (`invariants.ts`):**  
   Enforces cross-contract invariants:
   - Storyboard, audio, and render config frame counts and frame rates must match identically.
   - Audio `durationSeconds * fps` must match `totalFrames` within +/- 1 frame.
   - Act 1 must start at frame 0, acts must be contiguous, and Act 3 must end at `totalFrames`.
   - The first shot must start at frame 0 and the last shot must end at `totalFrames`.
   - `cameraStart.projectionMode` and `cameraEnd.projectionMode` must match within every shot.
   - Skeletal joint trees must contain exactly 1 root and have zero dependency cycles.
   - Knee joints on facing characters must bend backward (`RIG_KNEE_BEND_INVERTED`).
   - Lateral translation must match character facing direction (`TRACK_FACING_DIRECTION_MISMATCH`).
   - Secondary-motion parts must be anchored at the joint pivot (`PART_DETACHED_FROM_JOINT_PIVOT`).
   - Foreground parallax rigs must remain strictly in front of the camera near-plane (`FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE`).
   - Piecewise Cubic Bezier morph bases and targets must maintain strict $C^0$ continuity across segment boundaries.
   - Lyrics must have sorted start frames, zero overlaps, and match their timestamps within 1 frame.

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

### Measured Quantitative Benchmark Numbers

| Pipeline Stage / Target | Median FPS | Peak Aggregate RSS | Plateau Growth | Max Drawables | Streams / Conformance | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Smoke Benchmark** (`test:benchmark:smoke`) | **46.31 FPS** | **312.80 MB** | $-5.14\text{ MB}$ | 42 peak | BT.709 `tv` | **PASS (Green)** |
| **Procedural Cinema** (`demo:phase2`) | **21.39 FPS** | **314.25 MB** | $+12.02\text{ MB}$ | 103 peak | BT.709 `tv` | **PASS (Green)** |
| **Audio Mux** (`demo:phase3`) | **19.30 FPS** | **329.61 MB** | $+1.39\text{ MB}$ | 103 peak | BT.709 `tv` + AAC 44.1k | **PASS (Green)** |
| **Multi-Agent Cinema** (`demo:phase4`) | **19.87 FPS** | **322.71 MB** | $+10.19\text{ MB}$ | 104 peak | BT.709 `tv` + AAC 44.1k | **PASS (Green)** |
| **Production Video** (`produce:video`) | **18.30 FPS** | **189.30 MB** | $+0.00\text{ MB}$ (recycled) | 104 peak | BT.709 `tv` + AAC 256k | **PASS (Green)** |
| **Studio Full Song Renderer** (`studio`) | **24.17 FPS** | **185.10 MB** | $+0.00\text{ MB}$ (recycled) | 65 peak | BT.709 `tv` + AAC 256k | **PASS (Green)** |

> [!NOTE]
> All benchmarks were measured under WSL2 Ubuntu (2 CPU threads allocated to FFmpeg) with memory target $< 400\text{ MB}$, hard ceiling $\le 600\text{ MB}$, and throughput gate $\ge 15.0\text{ FPS}$.
>
> **A/B Memory Profiling (`--expose-gc`):**
> On Node.js 24, V8's default garbage collection schedule delays reclaiming unreferenced external rasterization buffers, allowing memory to accumulate (+92 MB) and reach 404.66 MB aggregate RSS (triggering a memory target warning). Running with `NODE_OPTIONS="--expose-gc"` and triggering manual GC between chunks/iterations immediately sweeps unreferenced external buffers, stabilizing peak aggregate RSS at 312.80 MB (well below the 400 MB target) while rendering at 46.31 FPS.

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
- **Phase 3 (Completed):**  
  Offline audio signal feature extraction (7-band STFT, RMS envelopes, spectral flux, onset detection), `.features.bin` v1 $O(1)$ columnar reader, deterministic `.lrc` alignment, and FFmpeg AAC audio-video muxing.
- **Phase 4 (Completed):**  
  Multi-agent LLM orchestration: `DirectorAgent`, `RigAgent`, `ChoreographerAgent`, and `StudioAgentOrchestrator` with automated self-healing contract validation and repair loops.
- **Phase 5 (Completed):**  
  Full-length music video production engine (`produce:video`, `scripts/produce-music-video.ts`) supporting 10,598 frames (~6.0 minutes @ 30 FPS), chunked streaming rendering, fault-tolerant checkpoint management with instant resume, sub-second lossless FFmpeg concat stitching with uncompressed continuous master FLAC $\to$ AAC 256k audio, hierarchical macro-to-micro storyboard planning across 7 musical sections, and secondary articulated pursuit enforcer drone kinematics.

---

## 17. License

This repository is private. No open-source license has been declared.
The bundled DejaVu Sans font is distributed under its own license; see
[src/assets/fonts/LICENSE-DejaVu.txt](src/assets/fonts/LICENSE-DejaVu.txt).

