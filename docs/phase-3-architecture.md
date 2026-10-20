# Phase 3 Architecture: Offline Audio Intelligence, LRC Alignment, $O(1)$ Columnar Binary Reader & Audio Muxing

## 1. Overview & Architectural Objectives

Phase 3 extends the AI-Agent Animation Studio with an end-to-end **Offline Audio Intelligence, LRC Alignment & Audio-Video Muxing Pipeline** (`src/engine/audio/`, `python/`, and `src/renderer/`). It enables the engine to:
1. Ingest full-length real audio tracks (`.flac`, `.wav`, `.mp3`) and time-synchronized lyrics (`.lrc`, such as *Avenged Sevenfold — Trashed and Scattered*).
2. Extract frame-accurate 7-band STFT acoustic energy, global/rolling-local RMS, half-wave rectified spectral flux, onset strength, peak-picked beat events, and acoustically weighted lyric emphasis into a compact binary columnar format (`.features.bin`, `columnLayoutVersion: 1`).
3. Read frame features in $O(1)$ time via `ColumnarAudioFeatureReader` using flat `TypedArray` views (`< 2 MB` footprint for a 6-minute song) without materializing nested JavaScript objects on the V8 heap.
4. Mux the original audio stream (`-map 0:v:0 -map 1:a:0 -c:a aac -shortest`) directly into the final H.264 BT.709 `.mp4` container during streaming encode.

---

## 2. Binary Columnar Format Specification (`.features.bin` v1)

### 2.1 Fixed 32-Byte Little-Endian Header

| Byte Offset | Size | Type (LE) | Field | Constraint |
| :--- | :--- | :--- | :--- | :--- |
| `0..3` | `4 B` | `ASCII` | `magic` | `"AAAS"` (`0x41, 0x41, 0x41, 0x53`) |
| `4..5` | `2 B` | `uint16` | `columnLayoutVersion` | `1` |
| `6..7` | `2 B` | `uint16` | `fps` | `30` or `60` |
| `8..11` | `4 B` | `uint32` | `totalFrames` | $N > 0$ |
| `12..15` | `4 B` | `uint32` | `sampleRate` | `44100` or `48000` |
| `16..19` | `4 B` | `uint32` | `localWindowFrames` | $3 \times \text{fps}$ (`90` @ 30fps, `180` @ 60fps) |
| `20..23` | `4 B` | `float32` | `globalRmsMax` | Finite $> 0$ |
| `24..31` | `8 B` | `uint8[8]` | `reserved` | Zero-filled (`0x00`) |

### 2.2 Contiguous Columnar Payload ($53 \times N$ Bytes)

1. **13 `Float32` Columns ($52 \times N$ bytes):**
   `rms`, `rmsRelativeGlobal`, `rmsRelativeLocal`, `spectralFlux`, `onsetStrength`, `pitchEstimatedHz` (`0.0` = unvoiced, mapped to `undefined` at runtime), `subBass` ($20–60\text{ Hz}$), `bass` ($60–250\text{ Hz}$), `lowMid` ($250–500\text{ Hz}$), `mid` ($500–2000\text{ Hz}$), `highMid` ($2000–4000\text{ Hz}$), `presence` ($4000–6000\text{ Hz}$), `brilliance` ($6000–20000\text{ Hz}$).
2. **1 `Uint8` Column ($1 \times N$ bytes):**
   `isOnset` (`0` or `1`).
3. **Total Footprint Math:**
   $$\text{Bytes}(N) = 32 + 53 \times N$$
   - **6 minutes @ 30 fps ($N = 10,800$):** $572,432\text{ bytes} \approx \mathbf{0.55\text{ MiB}}$
   - **6 minutes @ 60 fps ($N = 21,600$):** $1,144,832\text{ bytes} \approx \mathbf{1.09\text{ MiB}} < 2.0\text{ MB}$

---

## 3. LRC Parser & Structural Instrumental Cutoff Truncation

Implemented in [`src/engine/audio/lrc-parser.ts`](file:///home/endricho/projects/other-techs/ai-agent-animation-studio/src/engine/audio/lrc-parser.ts) and mirrored in [`python/analyze_audio.py`](file:///home/endricho/projects/other-techs/ai-agent-animation-studio/python/analyze_audio.py):
1. **Metadata Tag Stripping:** Ignores `[ar:...]`, `[ti:...]`, `[al:...]`, `[au:...]`, `[length:...]`, `[by:...]`, `[offset:...]`, `[re:...]`, `[ve:...]`.
2. **Multi-Timestamp Chorus Expansion:** Lines with multiple `[mm:ss.xx]` prefixes (e.g., `[00:49.28][03:00.58] Trashed and scattered again...`) expand into distinct chronological lyric items.
3. **Empty-Timestamp Structural Cutoffs:** Timestamp lines with empty text (e.g., `[00:00.00][00:46.66][00:59.40]...[03:55.52]`) are recorded as instrumental/section cutoffs $\mathcal{C}_{\text{empty}}$.
4. **End-Time Truncation Formula:**
   $$t_i^{\text{end}} = \min\left(t_{i+1}^{\text{start}},\; c_i,\; t_i^{\text{start}} + 8.0,\; \text{songDurationSeconds}\right)$$
   preventing lyrics from lingering across guitar solos or instrumental breaks.
5. **Sorted, Non-Overlapping Invariants & $O(\log L)$ Lookup:**
   Validated by `LYRIC_TIMELINE_UNSORTED`, `LYRIC_TIMELINE_OVERLAP`, and `LYRIC_TIME_FRAME_MISMATCH` in [`src/schemas/invariants.ts`](file:///home/endricho/projects/other-techs/ai-agent-animation-studio/src/schemas/invariants.ts) and queried via binary search in [`FrameStateBuilder.findActiveLyric`](file:///home/endricho/projects/other-techs/ai-agent-animation-studio/src/engine/director/frame-state-builder.ts#L53-L80).

---

## 4. Module Directory Map

```text
src/
├── config/
│   └── render-config.ts         # Added AudioMuxConfigSchema (filePath, startSeconds, durationSeconds, bitrateKbps)
├── diagnostics/
│   └── ffprobe.ts               # Dual-stream video + AAC audio inspection (stream & audioStream)
├── engine/
│   └── audio/
│       ├── columnar-format.ts   # .features.bin v1 encode/decode & 4-byte Buffer alignment guard
│       ├── feature-reader.ts    # O(1) ColumnarAudioFeatureReader & SHA-256 verified loadAudioAnalysis
│       ├── lrc-parser.ts        # Multi-timestamp expansion & empty-timestamp truncation
│       ├── wav-analyzer.ts      # Radix-2 2048-pt FFT, 7-band STFT analyzer, FLAC/WAV decoder & synth
│       ├── python-bridge.ts     # Zero-shell subprocess bridge to python/analyze_audio.py
│       └── index.ts             # Barrel exports
└── renderer/
    └── ffmpeg-streamer.ts       # Dual-input rawvideo + audio AAC muxing (-map 0:v:0 -map 1:a:0 -shortest)
python/
├── analyze_audio.py             # Offline Python multi-band STFT & LRC analyzer
└── requirements.txt             # numpy, scipy, soundfile, librosa
```

---

## 5. Measured Performance & Quantitative Gate Verification

Measured on the target machine (Intel Core Ultra 5 125H, 18 threads, WSL2 Linux) using the real *Avenged Sevenfold — Trashed and Scattered* `.flac` + `.lrc` chorus excerpt (`npm run demo:phase3`):

| Criterion | Target / Limit | Measured Phase 3 Demo | Status |
| :--- | :--- | :--- | :--- |
| **Median Effective FPS** | $\ge 15.00\text{ FPS}$ | **19.30 FPS** (Runs: 18.71, 19.87, 19.30) | **PASS** |
| **Peak Aggregate RSS** | $< 400\text{ MB}$ (Target) / $\le 600\text{ MB}$ (Hard) | **329.61 MB** (Node: 193.33 MB, FFmpeg: 136.38 MB) | **PASS (Green)** |
| **Memory Plateau Growth** | $\le \max(32\text{ MB}, 10\%)$ over $3\times$ run | **$+1.39\text{ MB}$** ($180\text{f}: 329.61 \to 540\text{f}: 331.00\text{ MB}$) | **PASS** |
| **6-Minute `.features.bin` Size** | $< 2.0\text{ MB}$ | **0.55 MiB @ 30fps / 1.09 MiB @ 60fps** | **PASS** |
| **Output Video + Audio Streams** | H.264 BT.709 `tv` + AAC Audio | Validated via `ffprobe` (`video=h264`, `audio=aac` 44.1 kHz) | **PASS** |
| **Temporary Disk Files** | Zero `.svg`, `.png`, `.part.mp4`, or temp `.wav` | **0 files** | **PASS** |

