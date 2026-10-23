// A saved AI suggestion keeps its text, reason, keyword and evidence on the idea page, and the keyword report
// rejects dates that do not exist (frozen "today": 2026-10-21).
import { expect, test } from '@playwright/test';
import { MUG, STORES, SUGGESTIONS, USERS, e2ePool } from './fixtures/seed';
import { expectNoSeriousAxe } from './support/axe';
import { freezeClock, signIn } from './support/session';

const IDEA = 'idea_e2e_suggestion';

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  await signIn(page, USERS.admin.email);
});

test('a saved suggestion shows its text, reason, keyword and evidence links, without an empty image box', async ({ page }) => {
  const text = 'Cốc "Dog Mom" in tên thú cưng, có thể tặng nhân dịp Giáng sinh và dùng mỗi ngày';
  const pool = e2ePool();
  try {
    await pool.query(
      `insert into saved_ideas (id, store_id, source, source_ref, via, title, created_by, created_at, updated_at, snapshot)
       values ($1, $2, 'suggestion', $3, 'briefing', $4, $5, now(), now(), $6::jsonb)`,
      [
        IDEA,
        STORES.a.id,
        SUGGESTIONS.idea,
        text.slice(0, 40),
        USERS.admin.id,
        JSON.stringify({ kind: 'idea', text, reason: 'Ba ads cốc dog mom đang lên trong 3 ngày.', evidence: { ads: ['e2e_mug_1', 'e2e_mug_4'], news: ['news_e2e_2'] }, keyword: MUG.keyword }),
      ],
    );
    await page.goto(`/ideas/${IDEA}`);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText('Ba ads cốc dog mom đang lên trong 3 ngày.')).toBeVisible();
    await expect(page.getByText(`Keyword: ${MUG.keyword}`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'ad 1' })).toHaveAttribute('href', '/ads/e2e_mug_1');
    await expect(page.getByRole('link', { name: 'ad 2' })).toHaveAttribute('href', '/ads/e2e_mug_4');
    await expect(page.getByRole('link', { name: 'Personalized mugs top gift lists' })).toHaveAttribute('href', 'https://example.com/news/mugs');
    await expect(page.getByText('Chưa có ảnh')).toHaveCount(0);
    await expectNoSeriousAxe(page);
  } finally {
    await pool.query(`delete from saved_ideas where id = $1`, [IDEA]);
    await pool.end();
  }
});

// The report streams behind its loading skeleton, so Next answers 200 for a notFound() here; the page is the 404 page.
test('the keyword report shows the 404 page for a date that does not exist, not a server error', async ({ page }) => {
  for (const d of ['2026-13-45', '2026-02-31', '2026-02-29', '0000-01-01']) {
    await page.goto(`/keywords/${MUG.keywordId}/${d}`);
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' }), d).toBeVisible();
    await expect(page.getByText('A server error occurred')).toHaveCount(0);
  }
  await page.goto(`/keywords/${MUG.keywordId}/2028-02-29`);
  await expect(page.getByRole('heading', { name: MUG.keyword })).toBeVisible();
});
