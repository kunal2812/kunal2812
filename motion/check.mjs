import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
assert(!/selected work|<table|<script|Programmophone|PistoChat|Youdemy/i.test(readme), 'Project showcase or script remains in README');
assert(readme.includes('prefers-reduced-motion: reduce'), 'Reduced-motion fallback missing');
for (const match of readme.matchAll(/(?:src|srcset)="\.\/([^\"]+)"/g)) {
  assert((await stat(new URL(`../${match[1]}`, import.meta.url))).size > 0, `Missing ${match[1]}`);
}
const gif = new URL('../assets/hacker-hero.gif', import.meta.url);
const data = await readFile(gif);
assert.equal(data.subarray(0, 6).toString(), 'GIF89a');
assert(data.length < 4_000_000, 'Animation exceeds 4 MB budget');
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames:format=duration', '-of', 'json', fileURLToPath(gif)], { encoding: 'utf8', windowsHide: true });
assert.equal(probe.status, 0, probe.error?.message || probe.stderr);
const metadata = JSON.parse(probe.stdout);
assert.equal(metadata.streams[0].width, 1200);
assert.equal(metadata.streams[0].height, 420);
assert.equal(Number(metadata.streams[0].nb_frames), 72);
assert.equal(Number(metadata.format.duration), 6);
assert(data.includes(Buffer.from('NETSCAPE2.0')), 'GIF looping extension missing');
console.log(`README and motion checks passed: 1200×420, 72 frames, 6-second loop, ${(data.length / 1e6).toFixed(2)} MB.`);
