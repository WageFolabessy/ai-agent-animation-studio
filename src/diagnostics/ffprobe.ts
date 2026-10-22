import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

export const VideoStreamInfoSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pix_fmt: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  nb_frames: z.string().optional(),
  nb_read_frames: z.string().optional(),
  color_space: z.string().optional(),
  color_primaries: z.string().optional(),
  color_transfer: z.string().optional(),
  color_range: z.string().optional()
}).passthrough();

export type VideoStreamInfo = z.infer<typeof VideoStreamInfoSchema>;

export const AudioStreamInfoSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().positive().optional(),
  bit_rate: z.string().optional()
}).passthrough();

export type AudioStreamInfo = z.infer<typeof AudioStreamInfoSchema>;

export const FormatInfoSchema = z.object({
  duration: z.string().optional()
}).passthrough();

export const FfprobeOutputSchema = z.object({
  streams: z.array(z.record(z.string(), z.unknown())).default([]),
  format: FormatInfoSchema.optional()
}).passthrough();

export type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>;

export interface VideoProbeResult {
  filePath: string;
  stream: VideoStreamInfo;
  audioStream?: AudioStreamInfo;
  format?: z.infer<typeof FormatInfoSchema>;
  frameCount?: number;
}

/**
 * Runs ffprobe on a video file with argument arrays (no shell interpolation),
 * parses JSON output, and validates both primary video and optional audio streams.
 */
export function probeVideo(filePath: string): VideoProbeResult {
  const resolved = path.resolve(filePath);
  const args = [
    '-v', 'error',
    '-count_frames',
    '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,color_space,color_primaries,color_transfer,color_range,sample_rate,channels,bit_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    resolved
  ];

  let rawJson: string;
  try {
    rawJson = execFileSync('ffprobe', args, { encoding: 'utf8' });
  } catch (err) {
    throw new Error(`ffprobe failed on file "${resolved}"`, { cause: err });
  }

  const parsed = FfprobeOutputSchema.parse(JSON.parse(rawJson));
  if (parsed.streams.length === 0) {
    throw new Error(`ffprobe found no video stream in "${resolved}"`);
  }

  const rawVideoStream =
    parsed.streams.find((s) => s.codec_type === 'video') ?? parsed.streams[0];
  const stream = VideoStreamInfoSchema.parse(rawVideoStream);

  const rawAudioStream = parsed.streams.find((s) => s.codec_type === 'audio');
  const audioStream = rawAudioStream ? AudioStreamInfoSchema.parse(rawAudioStream) : undefined;

  const rawFrames =
    stream.nb_frames && stream.nb_frames !== 'N/A'
      ? Number.parseInt(stream.nb_frames, 10)
      : stream.nb_read_frames
        ? Number.parseInt(stream.nb_read_frames, 10)
        : undefined;
  const frameCount = Number.isInteger(rawFrames) ? rawFrames : undefined;

  return {
    filePath: resolved,
    stream,
    ...(audioStream ? { audioStream } : {}),
    format: parsed.format,
    frameCount
  };
}

/**
 * Validates progressive H.264 BT.709 tv limited-range color tags without throwing.
 * Returns true if the file exists and adheres strictly to H.264 BT.709 tv parameters, false otherwise.
 */
export function isBt709Tv(filePath: string): boolean {
  try {
    const probe = probeVideo(filePath);
    const stream = probe.stream;
    return (
      stream.codec_name === 'h264' &&
      stream.color_space === 'bt709' &&
      stream.color_primaries === 'bt709' &&
      stream.color_transfer === 'bt709' &&
      stream.color_range === 'tv'
    );
  } catch {
    return false;
  }
}

/**
 * Asserts that the video stream metadata adheres to BT.709 standard with TV (limited) range.
 */
export function assertBt709Tv(stream: VideoStreamInfo): void {
  const mismatches: string[] = [];

  if (stream.color_space !== 'bt709') {
    mismatches.push(`color_space: expected 'bt709', got '${stream.color_space}'`);
  }
  if (stream.color_primaries !== 'bt709') {
    mismatches.push(`color_primaries: expected 'bt709', got '${stream.color_primaries}'`);
  }
  if (stream.color_transfer !== 'bt709') {
    mismatches.push(`color_transfer: expected 'bt709', got '${stream.color_transfer}'`);
  }
  if (stream.color_range !== 'tv') {
    mismatches.push(`color_range: expected 'tv', got '${stream.color_range}'`);
  }

  if (mismatches.length > 0) {
    throw new Error(`BT.709 TV color metadata validation failed:\n  ${mismatches.join('\n  ')}`);
  }
}
