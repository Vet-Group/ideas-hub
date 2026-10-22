import { describe, expect, it } from 'vitest';
import { extractPosts, extractPostsV1 } from './extract.mjs';

// The shape of a logged-out page load: the story object, then its feedback block (trimmed).
const story = (id, { text, time = 1792537261, image = true } = {}) =>
  `{"post_id":"${id}"${text === undefined ? '' : `,"message":{"__typename":"X","text":"${text}"}`},"creation_time":${time}` +
  `${image ? `,"attachments":[{"photo_image":{"uri":"https:\\/\\/scontent.example\\/${id}.jpg"}}]` : ''}}`;
const feedback = (id, { reactions = 0, comments, shares } = {}) =>
  `{"subscription_target_id":"${id}","reaction_count":{"count":${reactions},"is_empty":false}` +
  `${comments === undefined ? '' : `,"comment_rendering_instance":{"comments":{"total_count":${comments}}}`}` +
  `${shares === undefined ? '' : `,"share_count":{"count":${shares}}`}}`;

describe('extractPosts', () => {
  it('reads each post once with its counts, text, time and image', () => {
    const page =
      story('111', { text: 'Spooky \\ud83d\\udea8 gift' }) + feedback('111', { reactions: 12, comments: 3, shares: 1 }) +
      story('222', { text: 'Second', time: 1792000000 }) + feedback('222', { comments: 0, shares: 0 }) + feedback('111', { reactions: 9 });
    expect(extractPosts(page)).toEqual([
      { post_id: '111', reactions: 12, comments: 3, shares: 1, text: 'Spooky 🚨 gift', created: '2026-10-20T23:01:01.000Z', image: 'https://scontent.example/111.jpg' },
      { post_id: '222', reactions: 0, comments: 0, shares: 0, text: 'Second', created: '2026-10-14T17:46:40.000Z', image: 'https://scontent.example/222.jpg' },
    ]);
  });

  it('never borrows a neighbour post fields: missing ones stay null', () => {
    // 111 has no text and no counts but reactions; 222 has all of them.
    const page = story('111') + feedback('111', { reactions: 4 }) + story('222', { text: 'Buy my mug', time: 1792000000 }) + feedback('222', { reactions: 1, comments: 2, shares: 7 });
    const [first] = extractPosts(page);
    expect(first).toMatchObject({ post_id: '111', reactions: 4, comments: null, shares: null, text: null, created: '2026-10-20T23:01:01.000Z' });
    // The pass-1 extractor did borrow them, which is why pass 2 records both.
    expect(extractPostsV1(page)[0]).toMatchObject({ shares: 7, comments: 2 });
  });

  it('keeps a post whose counts are missing as null, and survives a bad escape', () => {
    expect(extractPosts('{"subscription_target_id":"333"}')).toEqual([{ post_id: '333', reactions: null, comments: null, shares: null }]);
    const bad = '{"post_id":"444","message":{"text":"bad \\x escape"}}' + feedback('444', { reactions: 1 });
    expect(extractPosts(bad)[0]).toMatchObject({ post_id: '444', text: null });
  });
});
