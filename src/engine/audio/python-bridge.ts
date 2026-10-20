import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AudioAnalysisManifest } from '../../schemas/audio.contract.js';
import { loadAudioAnalysis, type ColumnarAudioFeatureReader } from './feature-reader.js';
import { resolveCrossPlatformPath } from './lrc-parser.js';

export interface PythonAudioAnalyzerOptions {
  readonly audioFilePath: string;
  readonly lrcFilePath?: string;
  readonly outManifestPath: string;
  readonly outBinaryPath: string;
  readonly fps: 30 | 60;
  readonly sampleRate?: 44100 | 48000;
  readonly startSeconds?: number;
  readonly durationSeconds?: number;
  readonly pythonExecutable?: 'python3' | 'python' | '.venv/bin/python';
}

const ALLOWED_PYTHON_EXECUTABLES = new Set(['python3', 'python', '.venv/bin/python']);

/**
 * Invokes `python/analyze_audio.py` via `execFileSync` with an explicit argument array
 * (zero shell interpolation) and loads the resulting `.manifest.json` + `.features.bin`.
 *
 * // TODO(security): If exposed to untrusted external service calls in a future web tier,
 * // run the Python analyzer inside a resource-limited container/sandbox.
 */
export function runPythonAudioAnalyzer(options: PythonAudioAnalyzerOptions): {
  manifest: AudioAnalysisManifest;
  reader: ColumnarAudioFeatureReader;
} {
  const pythonBin = options.pythonExecutable ?? 'python3';
  if (!ALLOWED_PYTHON_EXECUTABLES.has(pythonBin)) {
    throw new Error(`Security violation: disallowed python executable "${pythonBin}"`);
  }

  const workspaceRoot = path.resolve(process.cwd());
  const scriptPath = path.resolve(workspaceRoot, 'python/analyze_audio.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Python audio analyzer script not found at "${scriptPath}"`);
  }

  const resolvedAudio = resolveCrossPlatformPath(options.audioFilePath);
  if (!fs.existsSync(resolvedAudio) || !fs.statSync(resolvedAudio).isFile()) {
    throw new Error(`Audio input file not found: "${resolvedAudio}"`);
  }

  const resolvedManifest = path.resolve(options.outManifestPath);
  const resolvedBin = path.resolve(options.outBinaryPath);

  const args: string[] = [
    scriptPath,
    '--audio',
    resolvedAudio,
    '--out-manifest',
    resolvedManifest,
    '--out-bin',
    resolvedBin,
    '--fps',
    options.fps.toString(),
    '--sr',
    (options.sampleRate ?? 44100).toString()
  ];

  if (options.lrcFilePath !== undefined) {
    const resolvedLrc = resolveCrossPlatformPath(options.lrcFilePath);
    if (!fs.existsSync(resolvedLrc) || !fs.statSync(resolvedLrc).isFile()) {
      throw new Error(`LRC input file not found: "${resolvedLrc}"`);
    }
    args.push('--lrc', resolvedLrc);
  }

  if (options.startSeconds !== undefined) {
    args.push('--start-sec', options.startSeconds.toString());
  }
  if (options.durationSeconds !== undefined) {
    args.push('--duration-sec', options.durationSeconds.toString());
  }

  const executable =
    pythonBin === '.venv/bin/python' ? path.resolve(workspaceRoot, '.venv/bin/python') : pythonBin;

  execFileSync(executable, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return loadAudioAnalysis(resolvedManifest);
}
