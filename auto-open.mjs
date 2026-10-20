import { watch, existsSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { extname } from 'node:path';

// Direktori yang wajib diabaikan agar IDE tidak macet
const IGNORED_DIRS = [
  'node_modules',
  '.git',
  'output',
  'dist',
  'build',
  '.cache',
  '.gemini'
];

// Ekstensi berkas kerja yang ingin dipantau
const VALID_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md',
  '.py', '.sh', '.svg', '.css', '.html', '.yaml', '.yml'
]);

let debounceTimer = null;
let lastOpenedFile = '';

console.log('\x1b[32m✔ Auto-Open aktif:\x1b[0m Memantau seluruh proyek (root)...');

watch('.', { recursive: true }, (eventType, filename) => {
  if (!filename) return;

  // 1. Lewatkan jika berada di dalam folder yang diabaikan
  const isIgnored = IGNORED_DIRS.some(
    dir => filename === dir || filename.startsWith(dir + '/') || filename.includes('/' + dir + '/')
  );
  if (isIgnored) return;

  // 2. Lewatkan jika bukan ekstensi kode/konfigurasi
  if (!VALID_EXTS.has(extname(filename))) return;

  // 3. Terapkan debounce untuk menunggu agent selesai menulis berkas
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Pastikan berkas benar-benar ada dan bukan event penghapusan berkas
    if (!existsSync(filename)) return;
    try {
      if (!statSync(filename).isFile()) return;
    } catch {
      return;
    }

    if (filename !== lastOpenedFile) {
      lastOpenedFile = filename;
      exec(`agy-ide "${filename}"`, (error) => {
        if (!error) {
          console.log(`\x1b[34m[IDE]\x1b[0m Berkas terbuka di tab: ${filename}`);
        }
      });
      setTimeout(() => { lastOpenedFile = ''; }, 1500);
    }
  }, 350);
});