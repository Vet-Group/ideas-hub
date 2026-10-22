// Reads posts and their engagement counts out of a logged-out Facebook page load: the page HTML plus its
// GraphQL responses. Each post's feedback block carries the post id as `subscription_target_id`.

const parseString = (raw) => {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return null;
  }
};

/** Each post id with the index of its first `"post_id"`. */
function storyStarts(text) {
  const seen = new Map();
  for (const m of text.matchAll(/"post_id":"(\d+)"/g)) if (!seen.has(m[1])) seen.set(m[1], m.index);
  return seen;
}

/**
 * Each post's counts are read only up to the next post's feedback block, and its text, time and image only
 * from its own story: from its "post_id" up to the next post's. A post without a field gets null, never a
 * neighbour's value.
 * @param {string} text
 * @returns {{ post_id: string, reactions: number | null, comments: number | null, shares: number | null, text?: string | null, created?: string | null, image?: string | null }[]}
 */
export function extractPosts(text) {
  const feedback = [...text.matchAll(/"subscription_target_id":"(\d+)"/g)];
  const starts = storyStarts(text);
  const positions = [...starts.values()].sort((a, b) => a - b);
  const posts = new Map();
  for (const [i, m] of feedback.entries()) {
    if (posts.has(m[1])) continue;
    const next = feedback.slice(i + 1).find((f) => f[1] !== m[1]);
    const w = text.slice(m.index, Math.min(m.index + 12000, next?.index ?? text.length));
    const num = (re) => {
      const x = w.match(re);
      return x ? Number(x[1]) : null;
    };
    const post = {
      post_id: m[1],
      reactions: num(/"reaction_count":\{"count":(\d+)/),
      comments: num(/"comment_rendering_instance":\{"comments":\{"total_count":(\d+)/),
      shares: num(/"share_count":\{"count":(\d+)/),
    };
    const at = starts.get(m[1]);
    if (at !== undefined) {
      // Measured on a real page load: a story's message, time and image follow its "post_id" (29 to
      // ~25,000 characters on), before the next post's "post_id".
      const after = positions.find((p) => p > at);
      const s = text.slice(at, Math.min(after ?? text.length, at + 60000));
      const t = s.match(/"message":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/);
      post.text = t ? (parseString(t[1])?.slice(0, 200) ?? null) : null;
      const c = s.match(/"creation_time":(\d+)/);
      post.created = c ? new Date(Number(c[1]) * 1000).toISOString() : null;
      const img = s.match(/"(?:photo_image|image)":\{"uri":"((?:[^"\\]|\\.)*)"/);
      post.image = img ? parseString(img[1]) : null;
    }
    posts.set(m[1], post);
  }
  return [...posts.values()];
}

/**
 * The extractor pass 1 ran with (unbounded windows, first match, loose comment fallback). Pass 2 records its
 * output beside extractPosts on the same page loads, to measure how far pass 1 can be trusted.
 * @param {string} text
 */
export function extractPostsV1(text) {
  const posts = new Map();
  for (const m of text.matchAll(/"subscription_target_id":"(\d+)"/g)) {
    if (posts.has(m[1])) continue;
    const w = text.slice(m.index, m.index + 12000);
    const num = (re) => {
      const x = w.match(re);
      return x ? Number(x[1]) : null;
    };
    const post = {
      post_id: m[1],
      reactions: num(/"reaction_count":\{"count":(\d+)/),
      comments: num(/"comment_rendering_instance":\{"comments":\{"total_count":(\d+)/) ?? num(/"total_count":(\d+)/),
      shares: num(/"share_count":\{"count":(\d+)/),
    };
    const at = text.indexOf(`"post_id":"${m[1]}"`);
    if (at >= 0) {
      const s = text.slice(Math.max(0, at - 30000), at + 30000);
      const t = s.match(/"message":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/);
      post.text = t ? (parseString(t[1])?.slice(0, 200) ?? null) : null;
      const c = s.match(/"creation_time":(\d+)/);
      post.created = c ? new Date(Number(c[1]) * 1000).toISOString() : null;
      const img = s.match(/"(?:photo_image|image)":\{"uri":"((?:[^"\\]|\\.)*)"/);
      post.image = img ? parseString(img[1]) : null;
    }
    posts.set(m[1], post);
  }
  return [...posts.values()];
}
