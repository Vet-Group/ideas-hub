// Answers the spike's questions 1, 2, 3 and 5 from the two passes, the ads export and the post images.
//   node analyze.mjs      reads out/pass1.jsonl, out/pass2.jsonl, out/ads.jsonl (export-ads.sh), out/img/
// Prints the measures and the per-page table as Markdown, and writes out/summary.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const jsonl = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const loads = (pass) => jsonl(`out/${pass}.jsonl`).filter((r) => r.page_id);
const pass1 = loads('pass1');
const pass2 = loads('pass2');
const ads = jsonl('out/ads.jsonl');

/** Lowercased, whitespace collapsed, first 120 characters (plan "Matching posts to ads"). */
export const textKey = (s) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

/** aHash 8×8 as a 64-bit BigInt: each pixel above the mean of the grayscale thumbnail is a 1. */
export async function aHash(buf) {
  const px = await sharp(buf).resize(8, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  const mean = px.reduce((s, v) => s + v, 0) / px.length;
  return [...px].reduce((h, v) => (h << 1n) | (v > mean ? 1n : 0n), 0n);
}

export function hamming(a, b) {
  let x = a ^ b;
  let n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
}

const hashOrNull = async (buf) => {
  try {
    return await aHash(buf);
  } catch {
    return null;
  }
};

/** A load could not be read at all: an error, a non-200, or a login or checkpoint redirect. */
const isWall = (r) => !!r.error || r.status !== 200 || /\/login|checkpoint/.test(r.final_url ?? '');
const hasCounts = (p) => p.reactions !== null && p.comments !== null && p.shares !== null;

async function main() {
  const all = [...pass1, ...pass2];
  const postHash = new Map();
  for (const p of all.flatMap((r) => r.posts)) {
    if (postHash.has(p.post_id)) continue;
    const f = `out/img/${p.post_id}.jpg`;
    if (existsSync(f)) postHash.set(p.post_id, await hashOrNull(readFileSync(f)));
  }
  const pages = [];
  for (const pageId of [...new Set(pass1.map((r) => r.page_id))]) {
    const l1 = pass1.find((r) => r.page_id === pageId);
    const l2 = pass2.find((r) => r.page_id === pageId);
    const posts = l1?.posts ?? [];
    // Pass 2 read text and images with the nearest-match extractor (fixed after pass 1 started), so its
    // copy of a post wins for matching; posts seen in one pass only still count.
    const forMatch = [...new Map([...posts, ...(l2?.posts ?? [])].map((p) => [p.post_id, p])).values()];
    const pageAds = ads.filter((a) => a.page_id === pageId);
    let matched = 0;
    let byText = 0;
    let byImage = 0;
    for (const ad of pageAds) {
      const t = textKey(ad.caption);
      const text = !!t && forMatch.some((p) => textKey(p.text) === t);
      const h = ad.thumb ? await hashOrNull(Buffer.from(ad.thumb, 'base64')) : null;
      const image = h !== null && forMatch.some((p) => postHash.get(p.post_id) != null && hamming(h, postHash.get(p.post_id)) <= 6);
      if (text) byText++;
      if (image) byImage++;
      if (text || image) matched++;
    }
    const later = new Map((l2?.posts ?? []).map((p) => [p.post_id, p]));
    const both = posts.filter((p) => later.has(p.post_id) && hasCounts(p) && hasCounts(later.get(p.post_id)));
    const moved = both.filter((p) => ['reactions', 'comments', 'shares'].some((k) => later.get(p.post_id)[k] !== p[k]));
    const gain = both.reduce((s, p) => s + (later.get(p.post_id).reactions - p.reactions), 0);
    pages.push({
      page_id: pageId,
      title: (l1?.title ?? '').replace(/ \| Facebook$/, ''),
      posts: posts.length,
      with_counts: posts.filter(hasCounts).length,
      walls: [l1, l2].filter((r) => r && isWall(r)).length,
      empty_loads: [l1, l2].filter((r) => r && !isWall(r) && r.posts.length === 0).length,
      ads: pageAds.length,
      matched,
      by_text: byText,
      by_image: byImage,
      in_both: both.length,
      moved: moved.length,
      reaction_gain: gain,
    });
  }
  const sum = (k) => pages.reduce((s, p) => s + p[k], 0);
  const readable = all.filter((r) => r.posts.some(hasCounts)).length;
  const summary = {
    loads: all.length,
    loads_pass1: pass1.length,
    loads_pass2: pass2.length,
    stopped: jsonl('out/pass1.jsonl').concat(jsonl('out/pass2.jsonl')).filter((r) => r.stopped),
    readable_loads: readable,
    walls: all.filter(isWall).length,
    empty_loads: all.filter((r) => !isWall(r) && r.posts.length === 0).length,
    posts: sum('posts'),
    posts_with_counts: sum('with_counts'),
    ads: sum('ads'),
    ads_matched: sum('matched'),
    ads_matched_text: sum('by_text'),
    ads_matched_image: sum('by_image'),
    posts_in_both: sum('in_both'),
    posts_moved: sum('moved'),
    pages,
  };
  writeFileSync('out/summary.json', JSON.stringify(summary, null, 2));
  const pct = (a, b) => (b ? `${Math.round((a * 100) / b)}%` : '-');
  console.log(`Loads ${summary.loads} (pass 1 ${summary.loads_pass1}, pass 2 ${summary.loads_pass2}); stopped early: ${summary.stopped.length}`);
  console.log(`Q1 readable: ${readable}/${summary.loads} loads (${pct(readable, summary.loads)}) had a post with all three counts; ${summary.posts_with_counts}/${summary.posts} posts in pass 1 had all three`);
  console.log(`Q2 blocked: ${summary.walls} walls or errors, ${summary.empty_loads} loads with no post read`);
  console.log(`Q3 matched: ${summary.ads_matched}/${summary.ads} active ads (${pct(summary.ads_matched, summary.ads)}); by text ${summary.ads_matched_text}, by image ${summary.ads_matched_image}`);
  console.log(`Q5 moves: ${summary.posts_moved}/${summary.posts_in_both} posts read in both passes changed`);
  console.log('\n| Page | Posts | With counts | Walls | Empty loads | Active ads | Matched (text / image) | In both passes | Changed | Reactions gained |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of pages) {
    console.log(`| ${p.title || p.page_id} | ${p.posts} | ${p.with_counts} | ${p.walls} | ${p.empty_loads} | ${p.ads} | ${p.matched} (${p.by_text} / ${p.by_image}) | ${p.in_both} | ${p.moved} | ${p.reaction_gain} |`);
  }
}

if (process.argv[1]?.endsWith('analyze.mjs')) await main();
