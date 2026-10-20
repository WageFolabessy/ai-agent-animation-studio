# Python Offline Audio Intelligence Tooling (Phase 3)

This directory contains the offline Python audio analyzer (`analyze_audio.py`) that extracts frame-accurate multi-band STFT acoustic features and LRC lyric alignments into `.manifest.json` and `.features.bin` (`columnLayoutVersion: 1`).

## Setup (Optional Offline Virtual Environment)

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
```

> **Note:** For uncompressed PCM `.wav` files, both the zero-dependency TypeScript analyzer (`src/engine/audio/wav-analyzer.ts`) and `python/analyze_audio.py` (using `numpy` + standard library `wave`) can operate without requiring `librosa` to be installed. Installing `python/requirements.txt` enables `.flac` and `.mp3` decoding via `librosa` / `soundfile`.

## Usage

```bash
python3 python/analyze_audio.py \
  --audio path/to/song.flac \
  --lrc path/to/song.lrc \
  --out-manifest output/audio-work/song.manifest.json \
  --out-bin output/audio-work/song.features.bin \
  --fps 30 \
  --sr 44100
```

## Binary Layout Parity (`columnLayoutVersion: 1`)
Both `python/analyze_audio.py` and `src/engine/audio/wav-analyzer.ts` emit the exact same binary layout:
- **Header (`32` bytes, little-endian):** `magic="AAAS"` (`4B`), `version=1` (`uint16`), `fps` (`uint16`), `totalFrames` (`uint32`), `sampleRate` (`uint32`), `localWindowFrames` (`uint32`), `globalRmsMax` (`float32`), `reserved` (`8B` zeroed).
- **Columns (`53 * totalFrames` bytes):** 13 `Float32` columns (`rms`, `rmsRelativeGlobal`, `rmsRelativeLocal`, `spectralFlux`, `onsetStrength`, `pitchEstimatedHz`, `subBass`, `bass`, `lowMid`, `mid`, `highMid`, `presence`, `brilliance`) followed by 1 `Uint8` column (`isOnset`).
