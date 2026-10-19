import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

export const VideoStreamInfoSchema = z.object({
  codec_name: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  pix_fmt: z.string().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  nb_read_frames: z.string().optional(),
  color_space: z.string().optional(),
  color_primaries: z.string().optional(),
  color_transfer: z.string().optional(),
  color_range: z.string().optional()
}).passthrough();

export type VideoStreamInfo = z.infer<typeof VideoStreamInfoSchema>;

export const FormatInfoSchema = z.object({
  duration: z.string().optional()
}).passthrough();

export const FfprobeOutputSchema = z.object({
  streams: z.array(VideoStreamInfoSchema).default([]),
  format: FormatInfoSchema.optional()
}).passthrough();

export type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>;

export interface VideoProbeResult {
  filePath: string;
  stream: VideoStreamInfo;
  format?: z.infer<typeof FormatInfoSchema>;
  frameCount?: number;
}

/**
 * Runs ffprobe on a video file with argument arrays (no shell interpolation),
 * parses JSON output, and validates it against the schema.
 */
export function probeVideo(filePath: string): VideoProbeResult {
  const resolved = path.resolve(filePath);
  const args = [
    '-v', 'error',
    '-count_frames',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames,color_space,color_primaries,color_transfer,color_range',
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

  const stream = parsed.streams[0];
  const frameCount = stream.nb_read_frames ? Number.parseInt(stream.nb_read_frames, 10) : undefined;

  return {
    filePath: resolved,
    stream,
    format: parsed.format,
    frameCount: Number.isInteger(frameCount) ? frameCount : undefined
  };
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
