# AI-Agent Animation Studio

Zero-browser in-memory procedural 2.5D animation rendering engine and automated music video generation studio.

---

## 1. Project Purpose & Vision

AI-Agent Animation Studio is an automated procedural 2.5D animation rendering engine and cinema director engineered to convert song audio (`.flac` / `.mp3`) and time-stamped lyrics (`.lrc`) into cinematic, narrative animated music videos across **any musical genre** (Pop, Rock, Metal, Ballad, Acoustic, Electronic).

### Strategic Manifesto: Procedural 2.5D Vector vs. Generative AI Video
This project **explicitly rejects generative AI video models (diffusion, Sora, Runway, Kling, Pika)**. Rather than relying on black-box pixel hallucination with temporal flickering, rubbery anatomy, and loose audio sync, the studio is built on **100% deterministic, controllable, code-driven procedural 2.5D SVG vector engineering**:
- **Absolute Directorial Control:** Precise camera paths, joint limits, kinematic spline tangents, and color palettes.
- **Zero Temporal Degradation:** Anatomical skeletons and rigid bone lengths never warp or lose identity between frames.
- **Frame-Exact Audio & Lyric Sync:** Sub-frame beat snapping and $O(1)$ columnar binary audio analysis synchronize lighting pulses, camera trauma shake, and facial phonemes to acoustic transients.
- **Ultra-Lightweight In-Memory Execution:** Renders 1080p @ 30/60 FPS entirely on CPU with zero browser dependencies and bounded memory ($< 400\text{ MB}$ RSS).
- **Infinite Vector Scalability:** Sharp mathematical vector geometry rendered directly in RAM via Rust `@resvg/resvg-js`.

The creative vision draws inspiration from iconic narrative music videos (such as Avenged Sevenfold's *"A Little Piece of Heaven"*) and classic vector/cutout storytelling (*Samurai Jack*, *South Park*, *Limbo*, *The Tale of the Three Brothers*), reimagined as a fully autonomous procedural vector cinema.

For complete architectural details, see [Theatrical Narrative 2.5D Procedural Cinema Architecture](docs/theatrical-narrative-architecture.md).

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
  - Spec-Then-Compile studio orchestration: `StorySpecAgent` (`src/agents/story-spec-agent.ts`) and `StudioAgentOrchestrator` (`src/agents/orchestrator.ts`).
  - Embedded Zod 4 `draft-07` JSON Schemas in agent system prompts for zero-shot real LLM conformance.
  - Stateless closed-loop self-healing retry pipeline with `[PREVIOUS FAILED JSON DRAFT]` retention and diagnostics feedback across schema (`LlmSchemaValidationError`) and invariant failures.
  - Kinematic smoothing and visual polish: periodic Hermite spline tangent unwrapping, stride phase continuity across camera cuts, seamless neck (`neck_collar`) and waist (`abdomen_core`) connectors on close-ups, elimination of floating double-offsets on coat wings/ribbons (`PART_DETACHED_FROM_JOINT_PIVOT`), and near-plane clipping prevention for foreground gantries (`FOREGROUND_RIG_CROSSES_CAMERA_NEAR_PLANE`).
- **Phase 5: Completed**
  - Production-grade full-song music video generator (`scripts/produce-music-video.ts`, `npm run produce:video`, and canonical `scripts/studio.ts --produce`) rendering up to 10,598 frames (~6.0 minutes @ 30 FPS) with single-line interactive ASCII progress telemetry (`\r`).
  - Chunked streaming rendering pipeline (`src/engine/director/chunk-renderer.ts`) and fault-tolerant checkpoint manager (`src/engine/director/checkpoint-manager.ts`) supporting deep `ffprobe` inspection, automated corrupted-chunk purging, and zero-overhead instant resume (`--resume`).
  - Sub-second lossless assembly via FFmpeg Concat Demuxer (`src/engine/audio/concat-stitcher.ts`) with continuous uncompressed master FLAC $\to$ AAC 256kbps stereo audio muxing (`-c:v copy -c:a aac -shortest`).
  - Hierarchical acoustic timeline segmenter (`src/engine/director/acoustic-segmenter.ts`) decomposing full songs into distinct musical sections with dynamic thematic palettes (`CYBERPUNK_CYAN`, `VOLTAGE_ORANGE`, `SUNSET_GOLD`, `CRIMSON_FURY`, `MIDNIGHT_VOID`).
  - Secondary articulated pursuit enforcer drone rig (`CANONICAL_RIG_IDS.PURSUIT_DRONE`) with 4-joint FK thrusters and dynamic flight tracking.
- **Phase 6: Completed**
  - Forensic visual remediation eliminating camera inside character / near-plane blob explosions and framing decapitation defects.
  - Mathematical safe-framing invariant verification suite ([`tests/safe-framing.test.ts`](tests/safe-framing.test.ts)) guaranteeing $z_c \ge 135.0$, bounded screen horizontal framing ($500 \le x_s \le 1420$), and safe head height ($354 \le y_{s,\text{head}} \le 504$) across all 10,598 frames in 41ms.
  - Motion state machine with 6 named looping motion presets (`stalk_crouch`, `sprint_frenzy`, `evade_leap`, `defiant_scream`, `combat_clash`, `exhausted_walk`) in [`ArchetypeFactory`](src/engine/library/archetype-factory.ts).
  - Anti-moonwalk tracking solver in [`choreography-solver.ts`](src/engine/director/choreography-solver.ts) locking camera velocity to character displacement ($\Delta X_{\text{cam}} = \Delta X_{\text{runner}}$) during continuous tracking shots.
  - 4-tier continuous parallax world generation (`SKYLINE_BACKDROP`, `MID_CITY_BLOCKS`, `NEAR_COLUMNS`, `GROUND_STRIP`) resolving the empty-black-space defect.
- **Phase 7: Active / In Progress (Theatrical Narrative Staging & Universal Genre Evolution)**
  - Transition from single-line treadmill running into discrete theatrical scene staging (`SetStageSchema`).
  - Multi-character interpersonal casting and relational blocking (Protagonist, Partner, Antagonist).
  - Multi-angle character rigs (Frontal $0^\circ$, $3/4$ perspective, and profile $90^\circ$) with expressive lyric-synchronized singing phonemes.
  - Narrative vector prop system (microphones, umbrellas, park benches, lanterns, instruments).
  - Universal genre-aware directing matrix adapting visual aesthetic to Pop, Ballad, Rock, Metal, Acoustic, and Electronic music.

For technical specifications, see:
- [Theatrical Narrative Architecture (Phase 7 & Beyond)](docs/theatrical-narrative-architecture.md)
- [Phase 1 Architecture Foundation](docs/phase-1-architecture.md)
- [Phase 2 Cinema & Compositor Architecture](docs/phase-2-architecture.md)
- [Phase 3 Audio Intelligence, LRC & Muxing Architecture](docs/phase-3-architecture.md)
- [Phase 4 Multi-Agent LLM Orchestration Architecture](docs/phase-4-architecture.md)
- [Phase 5 Production Video Architecture](docs/phase-5-architecture.md)
- [Phase 6 Remediation & Safe-Framing Architecture](docs/phase-6-architecture.md)

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
5. **Atomic Output Publishing & Content-Addressed Chunk Caching:**
   FFmpeg writes directly to a temporary staging file (`.part.mp4`). Only upon clean termination (exit code 0) and contract validation is the file committed atomically to its final destination via `fs.renameSync`.
   Chunk caching uses SHA-256 fingerprinting over canonical deep-sorted JSON of all render parameters, story spec, storyboard, rigs, choreography, and audio analysis. Metadata is written atomically to `${chunkFilename}.meta.json`.

### Content-Addressed Chunk Cache & `ENGINE_RENDER_VERSION` Bump Rules
The engine enforces deterministic content-addressed caching for chunked rendering via `src/config/render-version.ts`:
- **When to Bump `ENGINE_RENDER_VERSION`:**
  1. Bump `ENGINE_RENDER_VERSION` (monotonically incrementing integer: `1, 2, 3...`) whenever rendering math, projection matrix, camera FOV calculation, lighting decay, SVG styling, or kinematics logic changes in `src/engine/`.
  2. Bumping `ENGINE_RENDER_VERSION` causes `inspectChunk()` to evaluate all existing cached chunks as `STALE`, safely forcing a fresh re-render and preventing stale or mismatched video frames from reaching the concat stitcher.
  3. **Do NOT bump** for changes that do not affect rendered visual output (e.g. CLI argument formatting, test fixtures, documentation, or logging).

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
│   ├── phase-4-architecture.md    # Phase 4 multi-agent LLM orchestration architecture
│   ├── phase-5-architecture.md    # Phase 5 production video architecture & chunked engine
│   ├── phase-6-architecture.md    # Phase 6 safe-framing remediation, motion presets & parallax
│   └── theatrical-narrative-architecture.md # Phase 7 theatrical narrative 2.5D procedural studio vision
├── python/
│   ├── README.md                  # Python offline ML audio analysis tooling guide
│   ├── __init__.py                # Python package root
│   ├── analyze_audio.py           # Offline STFT 7-band feature extraction & binary exporter
│   └── requirements.txt           # Python dependencies (numpy, scipy, soundfile)
├── scripts/
│   ├── benchmark-smoke.ts         # Smoke benchmark (Gate C: 3 runs @ 1080p, memory/speed gate)
│   ├── conformance-render.ts      # Conformance test (Gate B: pixel, color, metadata validation)
│   ├── demo-phase2-cinema.ts      # Multi-shot procedural cinema demo & plateau benchmark
│   ├── demo-phase3-audio.ts       # Audio intelligence, LRC alignment & AAC muxing demo
│   ├── demo-phase4-orchestration.ts # Multi-agent orchestration cinema demo & benchmark
│   ├── produce-music-video.ts     # Backward-compatible forwarder to studio.ts --produce
│   └── studio.ts                  # Canonical Spec-Then-Compile autonomous studio CLI with checkpointing
├── src/
│   ├── agents/
│   │   ├── README.md              # AI agents overview
│   │   ├── index.ts               # Barrel export for agents and orchestration modules
│   │   ├── llm-provider.ts        # OpenAiCompatibleProvider, DeterministicMockLlmProvider & draft retention
│   │   ├── orchestrator.ts        # StudioAgentOrchestrator: closed-loop self-healing repair loop
│   │   ├── repair-helper.ts       # Targeted subtree extraction and localized error diagnostic repair
│   │   ├── story-spec-agent.ts    # StorySpec Agent: lyric/acoustic dramaturgy, cast roles & beat snapping
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
│   │   │   ├── acoustic-segmenter.ts # Song-agnostic macro energy contour & 3-act musical segmentation
│   │   │   ├── camera-shake.ts    # Continuous impulse-decay trauma camera shake system
│   │   │   ├── checkpoint-manager.ts # Fault-tolerant chunk checkpointing, ffprobe validation & resume
│   │   │   ├── choreography-solver.ts # Multi-character entity tracks, presets & anti-moonwalk solver
│   │   │   ├── choreography.ts    # Entity track interpolation and audio-reactive morph evaluation
│   │   │   ├── chunk-renderer.ts  # In-memory streaming chunk renderer with memory recycling
│   │   │   ├── environment-generator.ts # Procedural 4-tier parallax world & 3D biome synthesis
│   │   │   ├── frame-state-builder.ts # Deterministic FrameStateContract orchestrator
│   │   │   ├── index.ts           # Director engine barrel export
│   │   │   ├── production-pipeline.ts # Modular end-to-end production rendering pipeline
│   │   │   ├── shot-planner.ts    # 6 cinematic angle formulas, FOV safety bounds & shot solver
│   │   │   └── shot-sequencer.ts  # O(log N) shot lookup, DOLLY/TRACKING, and circular ORBIT slerp
│   │   ├── effects/
│   │   │   └── particle-emitter.ts # Stateless analytical particle emitter & burst evaluator
│   │   ├── library/
│   │   │   ├── archetype-factory.ts # Biped runner, quadruped hound, aerial drone & 6 motion presets
│   │   │   ├── environment-kit.ts # Industrial city, rooftop, highway, bridge & reactor kits
│   │   │   └── types.ts           # Character and environment library archetype interfaces
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
│       ├── story-spec.contract.ts # High-level narrative spec, cast, and dramatic section schema
│       └── storyboard.contract.ts # Director storyboards, acts, and cinematic shots
└── tests/
    ├── acoustic-segmenter.test.ts # Song-agnostic acoustic segmentation & 3-act partitioning tests
    ├── agents-orchestrator.test.ts # Multi-agent orchestration, self-healing retries & visual invariants
    ├── audio-columnar.test.ts     # .features.bin binary layout, alignment guard & O(1) reader tests
    ├── audio-mux.test.ts          # Dual-stream FFmpeg video + AAC audio muxing & Python bridge tests
    ├── audio-parity.test.ts       # Sub-frame parabolic tempo estimation and TS vs Python parity tests
    ├── backpressure.test.ts       # Streamer backpressure, drain, and EPIPE recovery
    ├── benchmark-gates.test.ts    # Memory gate, plateau check, and artifact hygiene tests
    ├── chunk-stitching.test.ts    # Lossless Concat Demuxer assembly, audio muxing & chunk validation
    ├── clipping.test.ts           # Near/far frustum, 1/z depth, and canonical cube culling tests
    ├── demo-phase2.test.ts        # Cinema demo contracts, 180-frame budget, and determinism tests
    ├── depth-order.test.ts        # LayerPass priority and ground vs character depth ordering tests
    ├── depth-sort.test.ts         # Pre-clip depth keys, primitive splitting, and sort order tests
    ├── emitter-saturation.test.ts # FIFO ring-buffer particle emitter saturation and audio burst retention
    ├── environment-narrative.test.ts # 4-tier parallax world & dynamic 3D biome synthesis tests
    ├── font-rasterizer.test.ts    # Deterministic font rasterization tests
    ├── frame-state.test.ts        # Particle emitter, choreography, and FrameStateBuilder tests
    ├── invariants.test.ts         # Storyboard timeline, act, rig, and choreography invariants
    ├── library-kits.test.ts       # Modular archetype factory and environment kit generation tests
    ├── llm-resilience.test.ts     # Error taxonomy, exponential backoff, truncation detection & repair tests
    ├── lrc-parser.test.ts         # Deterministic LRC parser, multi-timestamp expansion & emphasis tests
    ├── math.test.ts               # Easing, spring physics, noise, and color math tests
    ├── pipeline-lifecycle.test.ts # Atomic commit, abort, and error lifecycle tests
    ├── pose-clips.test.ts         # 6 motion presets, joint clamping limits & Hermite continuity tests
    ├── production-pipeline.test.ts # End-to-end production pipeline, progress telemetry & video probe tests
    ├── rigging.test.ts            # FK chain, joint clamping, Bezier morphing, and billboard tests
    ├── safe-framing.test.ts       # 10,598-frame mathematical safe-framing (z_c >= 135, head centering)
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
| `lint` | `tsc --noEmit` | Validates static types and checks for compiler errors |
| `test` | `tsx --test tests/**/*.test.ts` | Runs the full automated test suite (181 tests across 32 suites) |
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

### 7. Spec-Then-Compile Autonomous Narrative Orchestration Demo
Executes the unified Spec-Then-Compile pipeline (`StorySpecAgent` $\to$ `compileStorySpecToStoryboard` $\to$ `ArchetypeFactory` $\to$ `solveChoreography` $\to$ `StudioAgentOrchestrator`) with automated self-healing contract repair loops:
```bash
# Default deterministic mock mode (100% offline, reproducible):
npm run demo:phase4

# Real OpenAI / OpenAI-compatible endpoint (e.g. Gemini, Ollama, Groq):
export LLM_API_KEY="your-api-key"
npm run demo:phase4 -- --provider openai

# Custom audio/lrc slice with custom duration and output name:
npm run demo:phase4 -- --audio "assets/audio/trashed-and-scattered.flac" --lrc "assets/audio/trashed-and-scattered.lrc" --start 49.0 --duration 6.0 --out "my_cinema.mp4"
```

### 8. Full-Length Music Video Production Engine
Executes the streaming production pipeline across full-length songs (~6 minutes / 10,598 frames) using chunked streaming rendering, content-addressed fingerprinting (`.meta.json` sidecars), and lossless FFmpeg concat stitching:
```bash
# Full-length production (default 1500f chunks, continuous AAC master audio):
npm run produce:video

# Custom chunk sizing and automated content-addressed resume:
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
- **Spec-Then-Compile Narrative Architecture:**  
  Single-agent narrative specification (`StorySpecAgent`) compiled deterministically to camera shots (`compileStorySpecToStoryboard`), 2.5D character rigs (`ArchetypeFactory`), and choreography (`solveChoreography`), coordinated by `StudioAgentOrchestrator` with automated self-healing contract validation and repair loops.
- **Production Streaming & Resume Pipeline:**  
  Full-length music video production engine (`npm run studio --produce`, `scripts/studio.ts`) supporting 10,598+ frames (~6.0 minutes @ 30 FPS), chunked streaming rendering, content-addressed fingerprinting with `.meta.json` sidecars, instant skip-rendering resume, sub-second lossless FFmpeg concat stitching with uncompressed continuous master FLAC $\to$ AAC 256k audio, and secondary articulated pursuit enforcer drone kinematics.
- **Continuous Trajectory & Musical Stride Engine:**  
  Mathematical safe-framing invariant verification suite ($z_c \ge 135$, horizontal and cranial bounds), motion state machine with 6 named looping motion presets, physically grounded stride length via forward kinematics foot contact analysis ($\le 2\%$ slip velocity), musical `timeScale` locked to the musical beat grid ($\in [0.6, 1.6]$), unified continuous character trajectory solver with zero camera tracking drift, and continuous 4-tier parallax skyline background generation.
- **Next Evolution (Active / In Progress):**  
  Theatrical Narrative Staging & Universal Genre Evolution: Transition from single-axis treadmill running to discrete theatrical sets (`SetStageContract`), multi-character casting and interpersonal relational blocking (Protagonist, Partner, Antagonist), multi-angle rigs (Frontal $0^\circ$, $3/4$ perspective) with lyric-synced singing phonemes, narrative vector props, and universal genre-aware directing matrices (Pop, Ballad, Rock, Metal, Acoustic, Electronic). See [Theatrical Narrative Architecture](docs/theatrical-narrative-architecture.md).

---

## 17. License

This repository is private. No open-source license has been declared.
The bundled DejaVu Sans font is distributed under its own license; see
[src/assets/fonts/LICENSE-DejaVu.txt](src/assets/fonts/LICENSE-DejaVu.txt).

