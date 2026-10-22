// Reads posts and their engagement counts out of a logged-out Facebook page load: the page HTML plus its
// GraphQL responses. Each post's feedback block carries the post id as `subscription_target_id`.

/**
 * @param {string} text
 * @returns {{ post_id: string, reactions: number | null, comments: number | null, shares: number | null, text?: string | null, created?: string | null, image?: string | null }[]}
 */
export function extractPosts(text) {
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
    // Text, time and first image belong to the story object around this post's "post_id"; the match
    // nearest to it is taken, so a neighbouring post's text is never borrowed.
    const at = text.indexOf(`"post_id":"${m[1]}"`);
    if (at >= 0) {
      const from = Math.max(0, at - 30000);
      const s = text.slice(from, at + 30000);
      const nearest = (re) => {
        let best = null;
        for (const x of s.matchAll(re)) if (!best || Math.abs(from + x.index - at) < Math.abs(from + best.index - at)) best = x;
        return best;
      };
      const t = nearest(/"message":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/g);
      post.text = t ? JSON.parse(`"${t[1]}"`).slice(0, 200) : null;
      const c = nearest(/"creation_time":(\d+)/g);
      post.created = c ? new Date(Number(c[1]) * 1000).toISOString() : null;
      const img = nearest(/"(?:photo_image|image)":\{"uri":"((?:[^"\\]|\\.)*)"/g);
      post.image = img ? JSON.parse(`"${img[1]}"`) : null;
    }
    posts.set(m[1], post);
  }
  return [...posts.values()];
}
