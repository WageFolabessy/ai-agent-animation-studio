# Phase 2 Architecture: Procedural Cinema, Kinematics, Morphing & Depth-Sorted Compositor

> **Document Status**: Production Architecture & Verification Record (Phase 2 Completed).  
> **Engine Version**: 0.2.0 (Phase 2 Cinema Engine)

---

## 1. Overview & Architectural Vision

Phase 2 transitions the **AI-Agent Animation Studio** from a raw streaming pipeline into an expressive, procedural 2.5D cinematic rendering studio. Operating under zero-browser, zero-per-frame-disk-I/O, and bounded memory constraints, Phase 2 implements:

1. **Procedural Cinema Director**:
   - Multi-shot timeline execution with O(log N) shot lookup (`ShotSequencer`).
   - Dynamic camera movement interpolating between standard Cartesian DOLLY/TRACKING and circular ORBIT trajectories preserving arc radius.
   - Audio-driven camera shake using a non-linear trauma accumulation model ($trauma \in [0, 1]$, $shake \propto trauma^2$) driven by multi-frequency value noise.
2. **2.5D Articulated Kinematics & Secondary Motion**:
   - Planar Forward Kinematics (FK) tree traversal with joint constraint clamping and parent-relative 2D affine transformation propagation.
   - Dynamic secondary spring motion solver governing passive elements (e.g. coat tails, antennae, hair) responding to audio onsets and inertial acceleration.
3. **Continuous Analytical Shape Morphing**:
   - Piecewise Cubic Bézier curve morphing with strict $C^0$ topological continuity.
   - Audio-reactive and keyframed morph target blending supporting additive expressions (e.g. mouth opening driven by RMS, brow raising driven by onsets, periodic blinking).
4. **Depth-Sorted Scene Compositor & Painter's Algorithm**:
   - Strict back-to-front primitive sorting ordering all drawables (3D world polygons, 3D boundary lines, 2.5D billboarded characters, planar parallax layers, particle emitters) by pre-clip camera-space centroid depth ($z_c$).
   - Large primitive recursive subdivision along $z = z_{\text{mean}}$ preventing depth sorting cycles across extended planes and grid lines.
   - Outward counter-clockwise (CCW) face winding order with outward normal backface culling.
   - Isolated boundary edge rendering eliminating polygon stroke priority rasterization clashes.
   - Zero-filter audio-reactive lighting pulses and radial gradient glow halos.

---

## 2. Mathematical & Algorithmic Foundations

### 2.1 Perspective-Correct Camera Space Depth Keying ($1/z$)
In perspective projection, depth varies inversely with camera-space $z$. For any vertex $v$, its pre-clip camera-space depth is clamped to the frustum:
$$z_c(v) = \text{clamp}(z_{\text{camera}}(v), z_{\text{near}}, z_{\text{far}})$$

For world polygons and line segments, the sorting key is the arithmetic mean of $z_c$ across all pre-clip vertices:
$$\text{key}_{\text{polygon}} = \frac{1}{N} \sum_{i=1}^N z_c(v_i)$$

Primitives spanning a large relative depth range ($r = (z_{\text{max}} - z_{\text{min}}) / \max(z_{\text{mean}}, z_{\text{near}}) > 0.30$) are recursively subdivided in camera space before sorting, preventing visual intersection errors.

### 2.2 Continuous Analytical Spring & Impulse Decay
Discrete 1-frame strobe checks are forbidden. Audio-reactive lighting, trauma shake, and secondary motion evaluate the continuous analytical impulse response:
$$I(t) = I_{\text{peak}} \cdot e^{-\lambda \Delta t}$$
where $\Delta t = (f - f_{\text{onset}}) / \text{fps}$ and $\lambda$ represents the analytical decay rate. For oscillatory secondary motion, the engine evaluates the closed-form harmonic oscillator:
$$x(t) = e^{-\zeta \omega_n t} \left( c_1 \cos(\omega_d t) + c_2 \sin(\omega_d t) \right)$$
where $\omega_d = \omega_n \sqrt{1 - \zeta^2}$ for underdamped systems ($\zeta < 1.0$).

### 2.3 Outward Normal Calculation & Backface Culling
All 3D geometric meshes strictly enforce Counter-Clockwise (CCW) vertex winding viewed from the outside:
$$\mathbf{e}_1 = \mathbf{w}_1 - \mathbf{w}_0, \quad \mathbf{e}_2 = \mathbf{w}_2 - \mathbf{w}_0$$
$$\mathbf{n} = \mathbf{e}_1 \times \mathbf{e}_2$$
In world space, a surface is front-facing if and only if the normal points toward the camera:
$$\mathbf{n} \cdot (\mathbf{p}_{\text{camera}} - \mathbf{w}_0) > 0$$
Back-facing surfaces ($\mathbf{n} \cdot \mathbf{v}_{\text{toCamera}} \le 0$) are culled prior to camera-space transformation, eliminating interior face artifacts.

---

## 3. Engine Pipeline & Module Hierarchy

```
src/
├── schemas/
│   ├── primitives.schema.ts     # Vec2, Vec3, CameraTransform, FrameRange
│   ├── audio.contract.ts        # AudioAnalysisManifest, AudioFrameFeature
│   ├── storyboard.contract.ts   # DirectorStoryboardContract, CinematicShot
│   ├── rig.contract.ts          # AssetRigContract, RigPart, Skeleton, Emitter
│   ├── frame.contract.ts        # FrameStateContract (single evaluated frame state)
│   ├── choreography.contract.ts # ChoreographyContract, EntityTracks, MorphBindings
│   └── invariants.ts            # validateProjectContracts & validateChoreography
├── engine/
│   ├── camera/
│   │   ├── camera-3d.ts         # Orthonormal camera basis, worldToCameraSpace
│   │   ├── clipping.ts          # Liang-Barsky, Sutherland-Hodgman, 1/z interpolation
│   │   └── projection.ts        # Camera-space to SVG viewport transformation
│   ├── math/
│   │   ├── easing.ts            # Linear, quad, cubic, sine, springImpulse
│   │   ├── spring.ts            # Analytical damped harmonic response & decay
│   │   ├── noise.ts             # Deterministic lowbias32 PRNG & valueNoise1D
│   │   └── color.ts             # HSL/RGB hex mixing, shading, lit gradients
│   ├── director/
│   │   ├── shot-sequencer.ts    # O(log N) shot lookup, DOLLY & ORBIT slerp
│   │   ├── camera-shake.ts      # Multi-octave trauma shake system
│   │   ├── choreography.ts      # Entity track interpolation & morph bindings
│   │   └── frame-state-builder.ts # Pure frame evaluation pipeline
│   ├── rigging/
│   │   ├── kinematics.ts        # 2D Forward Kinematics (FK) & Billboard projection
│   │   ├── deformer.ts          # Looping Hermite/Cubic pose keyframe sampler
│   │   └── morpher.ts           # Piecewise Cubic Bézier blending & flattening
│   ├── effects/
│   │   └── particle-emitter.ts  # Deterministic particle simulation & beat bursts
│   └── compositor/
│       ├── svg-builder.ts       # Typed XML-safe SVG builder (paths, gradients, groups)
│       ├── depth-sort.ts        # Painter's sorting comparator & primitive splitter
│       ├── lighting.ts          # Continuous palette pulse & shared lit gradients
│       └── scene-compositor.ts  # End-to-end depth-sorted SVG scene emitter
└── renderer/
    ├── rasterizer.ts            # Resvg-js in-memory rasterizer
    ├── ffmpeg-streamer.ts       # Backpressure-governed stdin pipe to FFmpeg
    └── pipeline.ts              # Lifecycle manager with atomic .part.mp4 commit
```

---

## 4. Phase 2 Cinema Demo Specifications

The Phase 2 procedural sequence is authored in `src/demo/phase2-cinema/` and executed via `npm run demo:phase2`:
- **Resolution & Framerate:** 1920x1080 @ 30 fps.
- **Duration:** 180 frames (6.000 seconds).
- **Act Structure:**
  - **Act 1** (`[0, 60)`): *Industrial Awakening* (Establishing wide shot, industrial parallax, ground grid, chimney smoke).
  - **Act 2** (`[60, 135)`): *Kinematic Acceleration* (Medium tracking shot + wide orbit arcing around articulated runner).
  - **Act 3** (`[135, 180)`): *Convergence* (Close-up dolly with Dutch roll $8^\circ \to 16^\circ$, `springImpulse` easing, facial morph expressions, and trauma camera shake).
- **Audio Manifest:** Deterministic 120 BPM audio features with beat events every 15 frames, multi-band energy, and time-synchronized lyrics (including XML-escaped `=` character).
- **Active Rigs:**
  - `rig-skyline`: Planar parallax background city silhouette.
  - `rig-factories`: Planar parallax midground factory roofs and smoke stacks.
  - `rig-fg-pipes`: Planar parallax foreground industrial pipes.
  - `rig-smoke`: Particle emitter generating buoyancy smoke particles with audio burst response.
  - `rig-runner`: 12-joint articulated cybernetic runner with 15 parts (including layered helmet cranium and morphed visor/jaw), looping running cycle pose track, coat-tail secondary spring motion, and 3 facial morph targets (`mouthOpen`, `browRaise`, `blink`).

---

## 5. Measured Performance & Quantitative Gate Verification

Measured on the target machine (Intel Core Ultra 5 125H, 18 threads, WSL2 Linux):

| Criterion | Target / Limit | Measured Phase 2 Demo | Status |
| :--- | :--- | :--- | :--- |
| **Median Effective FPS** | $\ge 15.00\text{ FPS}$ | **27.39 FPS** (Runs: 29.6, 27.4, 27.1) | **PASS** |
| **Generation Time** | $\le 12.0\text{ ms}$ (p95) | **0.7 ms avg / 1.4 ms p95** | **PASS** |
| **Rasterization Time** | $\le 50.0\text{ ms}$ (median) | **32.5 ms avg / 41.0 ms p95** | **PASS** |
| **Peak Aggregate RSS** | $< 400\text{ MB}$ (Target) / $\le 600\text{ MB}$ (Hard) | **334.49 MB** (Node: 204 MB, FFmpeg: 130 MB) | **PASS (Green)** |
| **Memory Plateau Growth** | $\le \max(32\text{ MB}, 10\%)$ over $3\times$ run | **$+12.53\text{ MB}$** ($180\text{f}: 334.49 \to 540\text{f}: 347.02\text{ MB}$) | **PASS** |
| **Drawables per Frame** | $\le 220$ | **102 peak** | **PASS** |
| **Gradient Shapes per Frame**| $\le 100$ | **22 peak** | **PASS** |
| **Live Particles per Frame** | $\le 150$ | **35 peak** | **PASS** |
| **Filters / Masks** | $0$ | **0** | **PASS** |
| **Output Video Conformance** | H.264, 1920x1080 @ 30fps, BT.709 tv | Validated via `ffprobe` (duration 6.000s) | **PASS** |
| **Temporary Disk Files** | Zero `.svg`, `.png`, or `.part.mp4` | **0 files** | **PASS** |

All criteria across all verification suites pass with 100% compliance.
