import { describe, expect, it } from 'vitest';
import { extractPosts } from './extract.mjs';

// The shape of a logged-out page load: the story object, then its feedback block (trimmed).
const story = (id, text, reactions, comments, shares) =>
  `{"post_id":"${id}","message":{"__typename":"X","text":"${text}"},"creation_time":1792537261,"attachments":[{"photo_image":{"uri":"https:\\/\\/scontent.example\\/${id}.jpg"}}]}` +
  `{"subscription_target_id":"${id}","reaction_count":{"count":${reactions},"is_empty":false},"comment_rendering_instance":{"comments":{"total_count":${comments}}},"share_count":{"count":${shares}}}`;

describe('extractPosts', () => {
  it('reads each post once with its counts, text, time and image', () => {
    const posts = extractPosts(story('111', 'Spooky \\ud83d\\udea8 gift', 12, 3, 1) + story('222', 'Second', 0, 0, 0) + story('111', 'dup', 9, 9, 9));
    expect(posts).toEqual([
      { post_id: '111', reactions: 12, comments: 3, shares: 1, text: 'Spooky 🚨 gift', created: '2026-10-20T23:01:01.000Z', image: 'https://scontent.example/111.jpg' },
      { post_id: '222', reactions: 0, comments: 0, shares: 0, text: 'Second', created: '2026-10-20T23:01:01.000Z', image: 'https://scontent.example/222.jpg' },
    ]);
  });

  it('keeps a post whose counts are missing as null', () => {
    expect(extractPosts('{"subscription_target_id":"333"}')).toEqual([{ post_id: '333', reactions: null, comments: null, shares: null }]);
  });
});
