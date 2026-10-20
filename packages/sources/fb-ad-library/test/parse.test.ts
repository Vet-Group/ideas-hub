import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError, classifyEmbedded, embeddedHasNext, landingDomain, normalizeAd, parseEmbedded, parseGraphql } from '../src';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

describe('parseEmbedded', () => {
  it('reads the 30 embedded ads, the total count and the has-next signal', () => {
    const conn = parseEmbedded(fixture('embedded'));
    expect(conn.ads).toHaveLength(30);
    expect(conn.count).toBe(50001);
    expect(conn.hasNext).toBe(true);
    expect(conn.captcha).toBe(false);
    expect(embeddedHasNext(conn, 30)).toBe(true);
    expect(classifyEmbedded(conn)).toEqual({ kind: 'ok' });
  });

  it('derives has-next from the total count when page_info is missing', () => {
    const conn = parseEmbedded(fixture('embedded'));
    expect(embeddedHasNext({ ...conn, hasNext: undefined }, 30)).toBe(true);
    expect(embeddedHasNext({ ...conn, hasNext: undefined, count: 30 }, 30)).toBe(false);
  });

  it('marks the no-results page as no_results, not a block', () => {
    const conn = parseEmbedded(fixture('no-results'));
    expect(conn.ads).toHaveLength(0);
    expect(conn.count).toBe(0);
    expect(conn.hasNext).toBe(false);
    expect(classifyEmbedded(conn)).toEqual({ kind: 'no_results' });
  });

  it('treats empty embedded data without the marker as blocked', () => {
    const conn = parseEmbedded(fixture('embedded'));
    expect(classifyEmbedded({ ...conn, ads: [] })).toEqual({ kind: 'blocked', reason: 'empty_embedded', signal: 'blocked' });
  });

  it('treats the captcha flag as a captcha block', () => {
    const conn = parseEmbedded(fixture('embedded').replace('"xfb_ad_library_is_captcha_required": false', '"xfb_ad_library_is_captcha_required": true'));
    expect(classifyEmbedded(conn)).toEqual({ kind: 'blocked', reason: 'captcha', signal: 'captcha' });
  });

  it('throws a ParseError on an unparseable payload or a missing connection', () => {
    expect(() => parseEmbedded('<html>')).toThrow(ParseError);
    expect(() => parseEmbedded('{"data":{}}')).toThrow(ParseError);
    expect(() => parseEmbedded('{"search_results_connection":{"edges":[{"node":{"collated_results":[{}]}}]}}')).toThrow(ParseError);
  });
});

describe('parseGraphql', () => {
  it('reads both scroll pages with their page_info', () => {
    for (const name of ['pagination-1', 'pagination-2']) {
      const conn = parseGraphql(fixture(name));
      expect(conn.ads).toHaveLength(10);
      expect(conn.count).toBeUndefined();
      expect(typeof conn.hasNext).toBe('boolean');
    }
  });

  it('accepts the for (;;); prefix', () => {
    expect(parseGraphql(`for (;;);${fixture('pagination-1')}`).ads).toHaveLength(10);
  });
});

describe('normalizeAd', () => {
  const ads = parseEmbedded(fixture('embedded')).ads.map(normalizeAd);

  it('fills the ad columns with Pacific dates', () => {
    const dco = ads.find((a) => a.adArchiveId === '900000000000001')!;
    expect(dco).toMatchObject({
      collationId: '900000000000002',
      collationCount: 1,
      pageId: '100000000000001',
      pageName: 'Page 1',
      landingDomain: 'shop-1.example',
      mediaType: 'DCO',
      isActive: true,
      startDate: '2026-07-29',
      endDate: '2026-10-19',
    });
    // DCO template text is skipped for the first card's text.
    expect(dco.caption).toBe('Caption 1');
    expect(dco.title).toBe('Title 1');
    expect(dco.thumbnail?.kind).toBe('image');
  });

  it('takes a video preview image when the ad has no image', () => {
    const video = ads.find((a) => a.mediaType === 'VIDEO')!;
    expect(video.thumbnail?.kind).toBe('video');
    expect(video.thumbnail?.url).toMatch(/^https:\/\//);
  });

  it('every ad keeps its parsed JSON', () => {
    expect(ads.every((a) => a.parsed.ad_archive_id === a.adArchiveId)).toBe(true);
  });

  it('derives the landing domain from the link', () => {
    expect(landingDomain('https://www.Shop-1.Example/collections/x')).toBe('shop-1.example');
    expect(landingDomain('https://www.facebook.com/somepage')).toBeNull();
    expect(landingDomain('not a url')).toBeNull();
    expect(landingDomain(null)).toBeNull();
  });
});
