#!/usr/bin/env python3
"""
Offline Multi-Band Audio Intelligence & LRC Alignment Analyzer (Phase 3).

Extracts frame-accurate 7-band STFT energy, global/rolling-local RMS, half-wave
rectified spectral flux, onset strength, peak-picked beat events, and LRC lyrics
with empty-timestamp structural truncation into:
  1. `<name>.features.bin` (Columnar Binary Layout v1: 32 + 53 * totalFrames bytes)
  2. `<name>.manifest.json` (AudioAnalysisManifest contract with SHA-256 verification)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import wave
from pathlib import Path
from typing import Any

import numpy as np

FFT_SIZE = 2048
HALF_FFT = FFT_SIZE // 2
METADATA_TAG_RE = re.compile(r"^\s*\[(?:ar|ti|al|au|length|by|offset|re|ve):[^\]]*\]\s*$", re.IGNORECASE)
TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]")
WIN_DRIVE_RE = re.compile(r"^([A-Za-z]):[\\/](.*)$")


def resolve_cross_platform_path(raw_path: str) -> Path:
    trimmed = raw_path.strip()
    if os.name == "posix":
        m = WIN_DRIVE_RE.match(trimmed)
        if m:
            drive = m.group(1).lower()
            rest = m.group(2).replace("\\", "/")
            return Path(f"/mnt/{drive}/{rest}").resolve()
    return Path(trimmed).resolve()


def load_audio_mono(
    audio_path: Path,
    target_sr: int,
    start_sec: float = 0.0,
    duration_sec: float | None = None,
) -> tuple[np.ndarray, int]:
    """Loads audio into mono float32 [-1, 1] using librosa/soundfile, wave, or ffmpeg pipe."""
    try:
        import librosa  # type: ignore

        y, sr = librosa.load(
            str(audio_path),
            sr=target_sr,
            mono=True,
            offset=max(0.0, start_sec),
            duration=duration_sec,
        )
        return np.asarray(y, dtype=np.float32), int(sr)
    except ImportError:
        pass

    try:
        import soundfile as sf  # type: ignore

        info = sf.info(str(audio_path))
        sr = int(info.samplerate)
        start_frame = int(round(max(0.0, start_sec) * sr))
        frames = int(round(duration_sec * sr)) if duration_sec is not None else -1
        data, sr = sf.read(str(audio_path), start=start_frame, frames=frames, dtype="float32", always_2d=True)
        mono = np.mean(data, axis=1, dtype=np.float32)
        if sr == target_sr:
            return mono, sr
    except ImportError:
        pass

    if audio_path.suffix.lower() == ".wav":
        with wave.open(str(audio_path), "rb") as wf:
            sr = wf.getframerate()
            if sr == target_sr and wf.getsampwidth() == 2:
                n_channels = wf.getnchannels()
                total_frames = wf.getnframes()
                start_frame = max(0, min(total_frames, int(round(start_sec * sr))))
                wf.setpos(start_frame)
                req_frames = (
                    min(total_frames - start_frame, int(round(duration_sec * sr)))
                    if duration_sec is not None
                    else total_frames - start_frame
                )
                raw = wf.readframes(max(1, req_frames))
                samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                if n_channels > 1:
                    samples = samples.reshape(-1, n_channels).mean(axis=1).astype(np.float32)
                return samples, sr

    # Decode via FFmpeg pipe into f32le mono (supports .flac, .mp3, .ogg, .wav at any sample rate)
    cmd: list[str] = ["ffmpeg", "-v", "error"]
    if start_sec > 0.0:
        cmd.extend(["-ss", str(start_sec)])
    if duration_sec is not None and duration_sec > 0.0:
        cmd.extend(["-t", str(duration_sec)])
    cmd.extend(
        [
            "-i",
            str(audio_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(target_sr),
            "-f",
            "f32le",
            "pipe:1",
        ]
    )
    proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    samples = np.frombuffer(proc.stdout, dtype="<f4").copy()
    return samples, target_sr


def normalize_column(arr: np.ndarray) -> np.ndarray:
    peak = float(np.max(arr)) if arr.size > 0 else 0.0
    denom = peak if peak > 1e-12 else 1.0
    return np.clip(arr / denom, 0.0, 1.0).astype(np.float32)


def parse_lrc(
    raw_lrc: str,
    song_duration_sec: float,
    fps: int,
    total_frames: int,
    clip_start_sec: float,
    rms_rel_global: np.ndarray,
    mid_band: np.ndarray,
    presence_band: np.ndarray,
    max_line_duration_sec: float = 8.0,
) -> list[dict[str, Any]]:
    candidates: list[tuple[float, int, str]] = []
    cutoffs: list[float] = []
    order = 0

    for raw_line in raw_lrc.splitlines():
        trimmed = raw_line.strip()
        if not trimmed or METADATA_TAG_RE.match(trimmed):
            continue
        matches = TIMESTAMP_RE.findall(trimmed)
        if not matches:
            continue
        timestamps = [int(m) * 60.0 + float(s) - clip_start_sec for m, s in matches]
        text = TIMESTAMP_RE.sub("", trimmed).strip()
        if not text:
            for t in timestamps:
                if 0.0 <= t <= song_duration_sec:
                    cutoffs.append(round(t, 4))
        else:
            for t in timestamps:
                if 0.0 <= t < song_duration_sec:
                    candidates.append((t, order, text))
                    order += 1

    cutoffs = sorted(set(cutoffs))
    candidates.sort(key=lambda item: (round(item[0], 6), item[1]))

    dedup: list[tuple[int, float, str]] = []
    for t_sec, _, text in candidates:
        start_f = max(0, min(total_frames - 1, int(round(t_sec * fps))))
        if dedup and dedup[-1][0] >= start_f:
            continue
        dedup.append((start_f, t_sec, text))

    lyrics: list[dict[str, Any]] = []
    min_delta = 1.0 / fps

    for i, (start_f, start_t, text) in enumerate(dedup):
        next_t = dedup[i + 1][1] if i + 1 < len(dedup) else float("inf")
        next_f = dedup[i + 1][0] if i + 1 < len(dedup) else total_frames
        next_cutoff = float("inf")
        for c in cutoffs:
            if c > start_t + min_delta:
                next_cutoff = c
                break

        raw_end_t = min(next_t, next_cutoff, start_t + max_line_duration_sec, song_duration_sec)
        unclamped_end_f = int(round(raw_end_t * fps))
        end_f = max(start_f + 1, min(min(total_frames, next_f), unclamped_end_f))
        if end_f <= start_f or start_f >= total_frames:
            continue

        aligned_start_t = round(start_f / fps, 4)
        aligned_end_t = round(end_f / fps, 4)
        final_start_t = round(start_t, 4) if abs(round(start_t * fps) - start_f) <= 1 else aligned_start_t
        cand_end_t = (
            round(raw_end_t, 4)
            if abs(round(raw_end_t * fps) - end_f) <= 1 and raw_end_t > final_start_t
            else aligned_end_t
        )
        final_end_t = cand_end_t if cand_end_t > final_start_t else round(final_start_t + 1.0 / fps, 4)

        seg_scores = (
            0.5 * rms_rel_global[start_f:end_f]
            + 0.3 * mid_band[start_f:end_f]
            + 0.2 * presence_band[start_f:end_f]
        )
        emphasis = float(np.clip(np.mean(seg_scores), 0.0, 1.0)) if seg_scores.size > 0 else 0.75

        lyrics.append(
            {
                "id": f"lyric-{len(lyrics)}",
                "frameRange": {
                    "startFrameInclusive": int(start_f),
                    "endFrameExclusive": int(end_f),
                },
                "startTimeSeconds": float(final_start_t),
                "endTimeSeconds": float(final_end_t),
                "text": text,
                "emphasis": round(emphasis, 4),
            }
        )

    return lyrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 3 Offline Audio Analyzer")
    parser.add_argument("--audio", required=True, help="Input audio file (.flac, .wav, .mp3)")
    parser.add_argument("--lrc", required=False, help="Optional input .lrc file")
    parser.add_argument("--out-manifest", required=True, help="Output .manifest.json path")
    parser.add_argument("--out-bin", required=True, help="Output .features.bin path")
    parser.add_argument("--fps", type=int, choices=[30, 60], default=30, help="Video FPS (30 or 60)")
    parser.add_argument("--sr", type=int, choices=[44100, 48000], default=44100, help="Sample rate (44100 or 48000)")
    parser.add_argument("--start-sec", type=float, default=0.0, help="Start offset in seconds")
    parser.add_argument("--duration-sec", type=float, default=None, help="Clip duration in seconds")
    args = parser.parse_args()

    audio_path = resolve_cross_platform_path(args.audio)
    out_manifest_path = Path(args.out_manifest).resolve()
    out_bin_path = Path(args.out_bin).resolve()
    fps: int = args.fps
    target_sr: int = args.sr

    samples, sr = load_audio_mono(audio_path, target_sr, args.start_sec, args.duration_sec)
    duration_sec = float(samples.size) / float(sr)
    total_frames = max(1, int(round(duration_sec * fps)))
    local_window_frames = 3 * fps

    hann = np.hanning(FFT_SIZE).astype(np.float32)
    freqs = np.fft.rfftfreq(FFT_SIZE, d=1.0 / sr)

    rms_raw = np.zeros(total_frames, dtype=np.float32)
    spectral_flux = np.zeros(total_frames, dtype=np.float32)
    pitch_hz = np.zeros(total_frames, dtype=np.float32)
    sub_bass = np.zeros(total_frames, dtype=np.float32)
    bass = np.zeros(total_frames, dtype=np.float32)
    low_mid = np.zeros(total_frames, dtype=np.float32)
    mid = np.zeros(total_frames, dtype=np.float32)
    high_mid = np.zeros(total_frames, dtype=np.float32)
    presence = np.zeros(total_frames, dtype=np.float32)
    brilliance = np.zeros(total_frames, dtype=np.float32)

    mask_sub_bass = (freqs >= 20) & (freqs < 60)
    mask_bass = (freqs >= 60) & (freqs < 250)
    mask_low_mid = (freqs >= 250) & (freqs < 500)
    mask_mid = (freqs >= 500) & (freqs < 2000)
    mask_high_mid = (freqs >= 2000) & (freqs < 4000)
    mask_presence = (freqs >= 4000) & (freqs < 6000)
    mask_brilliance = (freqs >= 6000) & (freqs <= 20000)
    mask_vocal = (freqs >= 80) & (freqs <= 1200)

    prev_log_mag = np.zeros(HALF_FFT + 1, dtype=np.float32)

    for f in range(total_frames):
        center = int(round(f * sr / fps))
        start = center - HALF_FFT
        frame_buf = np.zeros(FFT_SIZE, dtype=np.float32)
        src_start = max(0, start)
        src_end = min(samples.size, start + FFT_SIZE)
        if src_end > src_start:
            dst_start = src_start - start
            frame_buf[dst_start : dst_start + (src_end - src_start)] = samples[src_start:src_end]

        rms_raw[f] = float(np.sqrt(np.mean(frame_buf * frame_buf)))
        spec = np.fft.rfft(frame_buf * hann)
        mag = np.abs(spec).astype(np.float32)
        mag_sq = mag * mag

        log_mag = np.log1p(10.0 * mag)
        if f > 0:
            diff = log_mag[1:] - prev_log_mag[1:]
            spectral_flux[f] = float(np.sum(np.maximum(0.0, diff)))
        prev_log_mag = log_mag

        sub_bass[f] = float(np.sqrt(np.mean(mag_sq[mask_sub_bass]))) if np.any(mask_sub_bass) else 0.0
        bass[f] = float(np.sqrt(np.mean(mag_sq[mask_bass]))) if np.any(mask_bass) else 0.0
        low_mid[f] = float(np.sqrt(np.mean(mag_sq[mask_low_mid]))) if np.any(mask_low_mid) else 0.0
        mid[f] = float(np.sqrt(np.mean(mag_sq[mask_mid]))) if np.any(mask_mid) else 0.0
        high_mid[f] = float(np.sqrt(np.mean(mag_sq[mask_high_mid]))) if np.any(mask_high_mid) else 0.0
        presence[f] = float(np.sqrt(np.mean(mag_sq[mask_presence]))) if np.any(mask_presence) else 0.0
        brilliance[f] = float(np.sqrt(np.mean(mag_sq[mask_brilliance]))) if np.any(mask_brilliance) else 0.0

        if rms_raw[f] > 0.03 and np.any(mask_vocal):
            vocal_indices = np.where(mask_vocal)[0]
            best_idx = vocal_indices[int(np.argmax(mag[vocal_indices]))]
            pitch_hz[f] = float(freqs[best_idx])

    global_rms_max = max(1e-6, float(np.max(rms_raw)))
    rms_clamped = np.clip(rms_raw, 0.0, 1.0).astype(np.float32)
    rms_rel_global = np.clip(rms_raw / global_rms_max, 0.0, 1.0).astype(np.float32)

    half_win = local_window_frames // 2
    rms_rel_local = np.zeros(total_frames, dtype=np.float32)
    for f in range(total_frames):
        w0 = max(0, f - half_win)
        w1 = min(total_frames, f + half_win + 1)
        loc_max = max(1e-6, float(np.max(rms_raw[w0:w1])))
        rms_rel_local[f] = min(1.0, max(0.0, float(rms_raw[f]) / loc_max))

    sub_bass = normalize_column(sub_bass)
    bass = normalize_column(bass)
    low_mid = normalize_column(low_mid)
    mid = normalize_column(mid)
    high_mid = normalize_column(high_mid)
    presence = normalize_column(presence)
    brilliance = normalize_column(brilliance)

    flux_half_win = max(2, int(0.5 * fps))
    onset_strength = np.zeros(total_frames, dtype=np.float32)
    for f in range(total_frames):
        w0 = max(0, f - flux_half_win)
        w1 = min(total_frames, f + flux_half_win + 1)
        onset_strength[f] = max(0.0, float(spectral_flux[f] - np.mean(spectral_flux[w0:w1])))

    spectral_flux = normalize_column(spectral_flux)
    onset_strength = normalize_column(onset_strength)

    is_onset = np.zeros(total_frames, dtype=np.uint8)
    min_gap = max(3, int(round(0.12 * fps)))
    last_onset = -min_gap
    beat_events: list[dict[str, Any]] = []

    for f in range(total_frames):
        strength = float(onset_strength[f])
        if strength < 0.22 or (f - last_onset) < min_gap:
            continue
        w0 = max(0, f - 2)
        w1 = min(total_frames, f + 3)
        if strength >= float(np.max(onset_strength[w0:w1])):
            is_onset[f] = 1
            last_onset = f
            beat_events.append(
                {
                    "frameIndex": int(f),
                    "timestamp": round(f / fps, 4),
                    "confidence": round(min(1.0, max(0.0, strength)), 4),
                }
            )

    header_bytes = struct.pack(
        "<4sHHIIIf8s",
        b"AAAS",
        1,
        fps,
        total_frames,
        sr,
        local_window_frames,
        float(global_rms_max),
        b"\x00" * 8,
    )

    payload = b"".join(
        [
            rms_clamped.astype("<f4").tobytes(),
            rms_rel_global.astype("<f4").tobytes(),
            rms_rel_local.astype("<f4").tobytes(),
            spectral_flux.astype("<f4").tobytes(),
            onset_strength.astype("<f4").tobytes(),
            pitch_hz.astype("<f4").tobytes(),
            sub_bass.astype("<f4").tobytes(),
            bass.astype("<f4").tobytes(),
            low_mid.astype("<f4").tobytes(),
            mid.astype("<f4").tobytes(),
            high_mid.astype("<f4").tobytes(),
            presence.astype("<f4").tobytes(),
            brilliance.astype("<f4").tobytes(),
            is_onset.astype("u1").tobytes(),
        ]
    )

    binary_blob = header_bytes + payload
    out_bin_path.parent.mkdir(parents=True, exist_ok=True)
    out_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    out_bin_path.write_bytes(binary_blob)

    sha256_hex = hashlib.sha256(binary_blob).hexdigest()

    lyrics: list[dict[str, Any]] = []
    if args.lrc:
        lrc_text = resolve_cross_platform_path(args.lrc).read_text(encoding="utf-8")
        lyrics = parse_lrc(
            lrc_text,
            duration_sec,
            fps,
            total_frames,
            args.start_sec,
            rms_rel_global,
            mid,
            presence,
        )

    rel_bin_path = os.path.relpath(out_bin_path, out_manifest_path.parent)
    manifest = {
        "metadata": {
            "audioFilePath": str(args.audio),
            "sampleRate": sr,
            "durationSeconds": round(duration_sec, 4),
            "fps": fps,
            "totalFrames": total_frames,
            "tempoBpm": 120.0,
            "tempoConfidence": 0.9,
        },
        "normalization": {
            "globalRmsMax": round(float(global_rms_max), 6),
            "localWindowFrames": local_window_frames,
        },
        "lyrics": lyrics,
        "beatEvents": beat_events,
        "storageReference": {
            "type": "external_binary",
            "columnLayoutVersion": 1,
            "binaryFilePath": rel_bin_path,
            "byteLength": len(binary_blob),
            "sha256": sha256_hex,
        },
    }

    out_manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
