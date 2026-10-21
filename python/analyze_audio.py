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
    try:
        if os.name == "posix":
            m = WIN_DRIVE_RE.match(trimmed)
            if m:
                drive = m.group(1).lower()
                rest = m.group(2).replace("\\", "/")
                return Path(f"/mnt/{drive}/{rest}").resolve()
        return Path(trimmed).resolve()
    except Exception:
        return Path(trimmed)


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


def estimate_tempo(y: np.ndarray, sr: int) -> tuple[float | None, float | None]:
    hop = 512
    fo = sr / hop
    num_hops = len(y) // hop
    if num_hops < 30:
        return None, None

    envelope = np.zeros(num_hops, dtype=np.float32)
    prev_low = 0.0
    prev_high = 0.0

    for m in range(num_hops):
        start = m * hop
        chunk = y[start : min(len(y), start + hop)]
        if len(chunk) < 2:
            continue
        s0 = chunk[:-1]
        s1 = chunk[1:]
        low_energy = float(np.sum((s0 + s1) ** 2))
        high_energy = float(np.sum((s0 - s1) ** 2))
        d_low = max(0.0, low_energy - prev_low)
        d_high = max(0.0, high_energy - prev_high)
        envelope[m] = d_low + 1.5 * d_high
        prev_low = low_energy
        prev_high = high_energy

    env_mean = float(np.mean(envelope))
    centered = envelope - env_mean
    env_var = float(np.sum(centered ** 2))
    if env_var < 1e-8:
        return None, None

    tau_min = int(round((60.0 / 200.0) * fo))
    tau_max = int(round((60.0 / 60.0) * fo))
    tau_0 = (60.0 / 120.0) * fo
    sigma_tau = 0.40

    lags = np.zeros(tau_max + 3, dtype=np.float32)
    raw_lags = np.zeros(tau_max + 3, dtype=np.float32)
    peak_tau = tau_min
    peak_val = -float("inf")

    for tau in range(tau_min - 1, tau_max + 2):
        limit = num_hops - tau
        x1 = centered[:limit]
        x2 = centered[tau : tau + limit]
        denom = math.sqrt(float(np.sum(x1 ** 2)) * float(np.sum(x2 ** 2)))
        norm_r = float(np.sum(x1 * x2)) / denom if denom > 1e-8 else 0.0
        raw_lags[tau] = norm_r
        prior = math.exp(-0.5 * ((math.log(tau / tau_0) / sigma_tau) ** 2))
        weighted = norm_r * prior
        lags[tau] = weighted
        if tau_min <= tau <= tau_max and weighted > peak_val:
            peak_val = weighted
            peak_tau = tau

    half_tau = int(round(peak_tau / 2.0))
    if half_tau >= tau_min and lags[half_tau] >= 0.45 * lags[peak_tau]:
        if lags[half_tau] >= lags[half_tau - 1] and lags[half_tau] >= lags[half_tau + 1]:
            peak_tau = half_tau

    alpha = float(lags[peak_tau - 1])
    beta = float(lags[peak_tau])
    gamma = float(lags[peak_tau + 1])
    denom_parabola = alpha - 2.0 * beta + gamma
    delta = 0.0
    if abs(denom_parabola) > 1e-8:
        delta = 0.5 * ((alpha - gamma) / denom_parabola)
        delta = max(-0.5, min(0.5, delta))

    refined_tau = peak_tau + delta
    bpm = (60.0 * fo) / refined_tau

    sub_lags = lags[tau_min : tau_max + 1]
    mean_r = float(np.mean(sub_lags))
    std_r = float(np.std(sub_lags))
    raw_beta = float(raw_lags[peak_tau])
    prominence = (beta - mean_r) / max(1e-5, std_r)
    confidence = max(0.0, min(1.0, (prominence / 2.5) * max(0.0, min(1.0, raw_beta))))

    if confidence < 0.40:
        return None, None

    return round(bpm, 2), round(confidence, 4)


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
    offset_match = re.search(r"\[offset:\s*([+-]?\d+)\s*\]", raw_lrc, re.IGNORECASE)
    offset_sec = float(offset_match.group(1)) / 1000.0 if offset_match else 0.0

    raw_candidates: list[tuple[float, int, str]] = []
    raw_cutoffs: list[float] = []
    order = 0

    for raw_line in raw_lrc.splitlines():
        trimmed = raw_line.strip()
        if not trimmed or METADATA_TAG_RE.match(trimmed):
            continue
        matches = TIMESTAMP_RE.findall(trimmed)
        if not matches:
            continue
        timestamps = [int(m) * 60.0 + float(s) + offset_sec for m, s in matches]
        text = TIMESTAMP_RE.sub("", trimmed).strip()
        if not text:
            for t in timestamps:
                raw_cutoffs.append(round(t, 4))
        else:
            for t in timestamps:
                raw_candidates.append((t, order, text))
                order += 1

    raw_cutoffs = sorted(set(raw_cutoffs))
    raw_candidates.sort(key=lambda item: (round(item[0], 6), item[1]))

    clip_end_sec = clip_start_sec + song_duration_sec
    min_delta = 1.0 / fps

    preprocessed: list[tuple[float, float, str]] = []
    for i, (start_abs, _, text) in enumerate(raw_candidates):
        next_cand_abs = raw_candidates[i + 1][0] if i + 1 < len(raw_candidates) else float("inf")
        next_cutoff_abs = float("inf")
        for c in raw_cutoffs:
            if c > start_abs + min_delta:
                next_cutoff_abs = c
                break

        abs_end_t = min(next_cand_abs, next_cutoff_abs, start_abs + max_line_duration_sec)
        if abs_end_t <= clip_start_sec or start_abs >= clip_end_sec:
            continue

        eff_start = max(clip_start_sec, start_abs)
        eff_end = min(clip_end_sec, abs_end_t)
        if eff_end > eff_start:
            preprocessed.append((round(eff_start - clip_start_sec, 4), round(eff_end - clip_start_sec, 4), text))

    dedup: list[tuple[int, float, float, str]] = []
    for t_start, t_end, text in preprocessed:
        start_f = max(0, min(total_frames - 1, int(round(t_start * fps))))
        if dedup and dedup[-1][0] >= start_f:
            continue
        dedup.append((start_f, t_start, t_end, text))

    lyrics: list[dict[str, Any]] = []

    for i, (start_f, start_t, pre_end_t, text) in enumerate(dedup):
        next_f = dedup[i + 1][0] if i + 1 < len(dedup) else total_frames
        unclamped_end_f = int(round(pre_end_t * fps))
        end_f = max(start_f + 1, min(min(total_frames, next_f), unclamped_end_f))
        if end_f <= start_f or start_f >= total_frames:
            continue

        aligned_start_t = round(start_f / fps, 4)
        aligned_end_t = round(end_f / fps, 4)
        final_start_t = round(start_t, 4) if abs(round(start_t * fps) - start_f) <= 1 else aligned_start_t
        cand_end_t = (
            round(pre_end_t, 4)
            if abs(round(pre_end_t * fps) - end_f) <= 1 and pre_end_t > final_start_t
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


def segment_audio_sections(
    rms_rel_global: np.ndarray,
    spectral_flux: np.ndarray,
    pitch_hz: np.ndarray,
    bands: dict[str, np.ndarray],
    total_frames: int,
    fps: int,
    beat_grid: dict[str, Any] | None = None,
    lyrics: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if total_frames <= 0:
        return []

    min_sec = 8.0
    max_sec = 55.0

    if beat_grid and "framesPerBar" in beat_grid:
        frames_per_bar = max(1, int(round(beat_grid["framesPerBar"])))
    else:
        frames_per_bar = max(1, int(round(4 * round((60 / 120) * fps))))

    if total_frames >= 180:
        min_section_frames = min(int(round(min_sec * fps)), max(1, total_frames // 3))
    else:
        min_section_frames = max(1, int(round(min_sec * fps)))
    max_section_frames = max(min_section_frames + 1, int(round(max_sec * fps)))

    # 1. Smoothed composite energy & novelty
    half_win = max(1, int(round(fps * 0.5)))
    comp_e = rms_rel_global + 0.4 * spectral_flux
    smooth_e = np.zeros(total_frames, dtype=np.float32)
    cs = np.pad(np.cumsum(comp_e), (1, 0))
    for f in range(total_frames):
        w_start = max(0, f - half_win)
        w_end = min(total_frames - 1, f + half_win)
        smooth_e[f] = (cs[w_end + 1] - cs[w_start]) / (w_end - w_start + 1)

    novelty = np.zeros(total_frames, dtype=np.float32)
    for f in range(total_frames):
        f_prev = max(0, f - half_win)
        f_next = min(total_frames - 1, f + half_win)
        novelty[f] = abs(smooth_e[f_next] - smooth_e[f_prev])

    candidates: list[tuple[int, float]] = []
    pos_nov = novelty[novelty > 1e-4]
    nov_thresh = float(np.percentile(pos_nov, 60)) if len(pos_nov) > 0 else 0.05

    for f in range(half_win, total_frames - half_win):
        if novelty[f] >= nov_thresh and novelty[f] >= novelty[f - 1] and novelty[f] >= novelty[f + 1]:
            candidates.append((f, float(novelty[f])))

    # 2. Lyric stanza gaps (>= 3.0s)
    if lyrics and len(lyrics) > 1:
        for i in range(1, len(lyrics)):
            gap_sec = lyrics[i]["startTimeSeconds"] - lyrics[i - 1]["endTimeSeconds"]
            if gap_sec >= 3.0:
                mid_sec = (lyrics[i - 1]["endTimeSeconds"] + lyrics[i]["startTimeSeconds"]) / 2.0
                gap_frame = int(round(mid_sec * fps))
                if 0 < gap_frame < total_frames:
                    candidates.append((gap_frame, 10.0 + gap_sec))

    downbeats = beat_grid.get("downbeatIndices") if beat_grid else None
    beat_indices = beat_grid.get("beatFrameIndices") if beat_grid else None
    offset = beat_indices[0] if beat_indices and len(beat_indices) > 0 else 0

    def snap_to_bar(f: int) -> int:
        if downbeats and len(downbeats) > 0:
            idx = int(np.argmin(np.abs(np.array(downbeats) - f)))
            return int(downbeats[idx])
        bar_num = int(round((f - offset) / frames_per_bar))
        return max(0, min(total_frames, offset + bar_num * frames_per_bar))

    boundaries: list[int] = [0]
    curr = 0

    while curr < total_frames:
        earliest = curr + min_section_frames
        latest = curr + max_section_frames

        if (total_frames - curr <= max_section_frames) and (total_frames - earliest < min_section_frames):
            break

        in_win = [
            (snap_to_bar(cf), score)
            for cf, score in candidates
            if earliest <= cf <= latest
        ]
        in_win = [
            (sf, score)
            for sf, score in in_win
            if earliest <= sf <= latest and sf < total_frames
        ]

        if in_win:
            in_win.sort(key=lambda x: x[1], reverse=True)
            next_b = in_win[0][0]
        else:
            nominal = curr + min(max_section_frames, max(min_section_frames, int(round(35.0 * fps))))
            next_b = min(latest, max(earliest, snap_to_bar(nominal)))

        if next_b <= curr:
            next_b = min(total_frames, curr + min_section_frames)

        boundaries.append(next_b)
        curr = next_b

    if boundaries[-1] != total_frames:
        boundaries.append(total_frames)

    if total_frames >= 180 and len(boundaries) - 1 < 3:
        b1 = max(1, snap_to_bar(int(round(total_frames / 3))))
        b2 = max(b1 + 1, snap_to_bar(int(round(2 * total_frames / 3))))
        clean_b1 = b1 if b1 < total_frames - 2 else total_frames // 3
        clean_b2 = b2 if clean_b1 < b2 < total_frames else (2 * total_frames) // 3
        boundaries = [0, clean_b1, clean_b2, total_frames]

    band_names = [
        "subBass",
        "bass",
        "lowMid",
        "mid",
        "highMid",
        "presence",
        "brilliance",
    ]

    sections: list[dict[str, Any]] = []
    for i in range(len(boundaries) - 1):
        s_start = boundaries[i]
        s_end = boundaries[i + 1]
        cnt = max(1, s_end - s_start)

        rel_energy = float(round(float(np.mean(rms_rel_global[s_start:s_end])), 4))
        rel_energy = max(0.0, min(1.0, rel_energy))

        band_means = {b: float(np.mean(bands[b][s_start:s_end])) for b in band_names}
        dominant_band = max(band_names, key=lambda b: band_means[b])

        has_vocals = False
        if lyrics and len(lyrics) > 0:
            for lyr in lyrics:
                fr = lyr.get("frameRange", {})
                start_f = fr.get("startFrameInclusive", int(round(lyr.get("startTimeSeconds", 0) * fps)))
                end_f = fr.get("endFrameExclusive", int(round(lyr.get("endTimeSeconds", 0) * fps)))
                if start_f < s_end and end_f > s_start:
                    has_vocals = True
                    break
        else:
            mid_pres = band_means["mid"] + band_means["presence"]
            voiced_cnt = int(np.count_nonzero(pitch_hz[s_start:s_end] > 0))
            has_vocals = (mid_pres >= 0.16) and (voiced_cnt / cnt >= 0.25)

        sections.append({
            "id": f"sec-{i + 1}",
            "startFrame": s_start,
            "endFrame": s_end,
            "relativeEnergy": rel_energy,
            "hasVocals": has_vocals,
            "dominantBand": dominant_band,
        })

    return sections


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

    valid_rms = rms_raw[rms_raw > 1e-6]
    p98_rms = float(np.percentile(valid_rms, 98)) if valid_rms.size > 0 else 1.0
    global_rms_max = p98_rms if p98_rms > 1e-6 else 1.0
    rms_clamped = np.clip(rms_raw, 0.0, 1.0).astype(np.float32)
    rms_rel_global = np.clip(rms_raw / global_rms_max, 0.0, 1.0).astype(np.float32)

    half_win = local_window_frames // 2
    rms_rel_local = np.zeros(total_frames, dtype=np.float32)
    for f in range(total_frames):
        w0 = max(0, f - half_win)
        w1 = min(total_frames, f + half_win + 1)
        loc_max = max(1e-6, float(np.max(rms_raw[w0:w1])))
        rms_rel_local[f] = min(1.0, max(0.0, float(rms_raw[f]) / loc_max))

    tot_band_energy = sub_bass + bass + low_mid + mid + high_mid + presence + brilliance
    valid_band = tot_band_energy[tot_band_energy > 1e-6]
    p98_band = float(np.percentile(valid_band, 98)) if valid_band.size > 0 else 1.0
    denom_band = p98_band if p98_band > 1e-6 else 1.0

    sub_bass = np.clip(sub_bass / denom_band, 0.0, 1.0).astype(np.float32)
    bass = np.clip(bass / denom_band, 0.0, 1.0).astype(np.float32)
    low_mid = np.clip(low_mid / denom_band, 0.0, 1.0).astype(np.float32)
    mid = np.clip(mid / denom_band, 0.0, 1.0).astype(np.float32)
    high_mid = np.clip(high_mid / denom_band, 0.0, 1.0).astype(np.float32)
    presence = np.clip(presence / denom_band, 0.0, 1.0).astype(np.float32)
    brilliance = np.clip(brilliance / denom_band, 0.0, 1.0).astype(np.float32)

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
    onset_half_win = max(2, int(round(0.5 * fps)))
    last_onset = -min_gap
    beat_events: list[dict[str, Any]] = []

    for f in range(total_frames):
        strength = float(onset_strength[f])
        w0 = max(0, f - onset_half_win)
        w1 = min(total_frames, f + onset_half_win + 1)
        mean_s = float(np.mean(onset_strength[w0:w1]))
        std_s = float(np.std(onset_strength[w0:w1]))
        adaptive_thresh = mean_s + 1.4 * std_s + 0.04

        if strength < adaptive_thresh or (f - last_onset) < min_gap:
            continue
        w0_peak = max(0, f - 2)
        w1_peak = min(total_frames, f + 3)
        if strength >= float(np.max(onset_strength[w0_peak:w1_peak])):
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

    tempo_bpm, tempo_conf = estimate_tempo(samples, sr)
    meta: dict[str, Any] = {
        "audioFilePath": str(args.audio),
        "sampleRate": sr,
        "durationSeconds": round(duration_sec, 4),
        "fps": fps,
        "totalFrames": total_frames,
    }
    if tempo_bpm is not None and tempo_conf is not None:
        meta["tempoBpm"] = tempo_bpm
        meta["tempoConfidence"] = tempo_conf

    beat_grid: dict[str, Any] | None = None
    if tempo_bpm is not None and tempo_conf is not None and tempo_conf >= 0.4:
        frames_per_beat = (60.0 / tempo_bpm) * fps
        frames_per_bar = 4.0 * frames_per_beat
        best_phase = 0
        best_energy = -1.0
        max_phase = max(1, int(round(frames_per_beat)))
        for phase in range(max_phase):
            energy = float(np.sum(onset_strength[phase::max_phase]))
            if energy > best_energy:
                best_energy = energy
                best_phase = phase

        beat_frame_indices = list(range(best_phase, total_frames, max_phase))
        bar_step = max(1, int(round(frames_per_bar)))
        downbeat_indices = list(range(best_phase, total_frames, bar_step))
        beat_grid = {
            "tempoBpm": tempo_bpm,
            "tempoConfidence": tempo_conf,
            "framesPerBeat": round(frames_per_beat, 4),
            "framesPerBar": round(frames_per_bar, 4),
            "beatFrameIndices": beat_frame_indices,
            "downbeatIndices": downbeat_indices,
        }

    rel_bin_path = os.path.relpath(out_bin_path, out_manifest_path.parent)
    sections = segment_audio_sections(
        rms_rel_global=rms_rel_global,
        spectral_flux=spectral_flux,
        pitch_hz=pitch_hz,
        bands={
            "subBass": sub_bass,
            "bass": bass,
            "lowMid": low_mid,
            "mid": mid,
            "highMid": high_mid,
            "presence": presence,
            "brilliance": brilliance,
        },
        total_frames=total_frames,
        fps=fps,
        beat_grid=beat_grid,
        lyrics=lyrics,
    )
    manifest: dict[str, Any] = {
        "metadata": meta,
        "normalization": {
            "globalRmsMax": round(float(global_rms_max), 6),
            "localWindowFrames": local_window_frames,
        },
        "lyrics": lyrics,
        "beatEvents": beat_events,
        "sections": sections,
        "storageReference": {
            "type": "external_binary",
            "columnLayoutVersion": 1,
            "binaryFilePath": rel_bin_path,
            "byteLength": len(binary_blob),
            "sha256": sha256_hex,
        },
    }
    if beat_grid is not None:
        manifest["beatGrid"] = beat_grid

    out_manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
