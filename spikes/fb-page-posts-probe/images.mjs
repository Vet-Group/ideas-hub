// Downloads the first image of each post read in a pass, for the image match in analyze.mjs.
//   node images.mjs <pass-name>     reads out/<pass-name>.jsonl, writes out/img/<post_id>.jpg
// Runs on the home PC like probe.mjs; one request every 1–3 s.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pass = process.argv[2] ?? 'pass1';
mkdirSync('out/img', { recursive: true });
const rows = readFileSync(`out/${pass}.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let got = 0;
let failed = 0;
for (const post of rows.flatMap((r) => r.posts ?? [])) {
  const file = `out/img/${post.post_id}.jpg`;
  if (!post.image || existsSync(file)) continue;
  try {
    const res = await fetch(post.image);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    got++;
  } catch (e) {
    failed++;
    console.log(`${post.post_id}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));
}
console.log(`images: ${got} saved, ${failed} failed`);
