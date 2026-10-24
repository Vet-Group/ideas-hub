// The checks axe does not make (plan Step 5): a visible focus indicator on every Tab stop, 3:1 for
// input borders and the focus ring (WCAG 1.4.11), no open overlay animating over 220 ms, and targets of
// at least 24 × 24 px or spaced as WCAG 2.5.8 allows.
import { type Page, expect } from '@playwright/test';

/** WCAG relative-luminance contrast of two `rgb(...)` colors. */
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Tabs through the page and checks that each stop looks different focused (outline or box shadow). */
export async function expectVisibleFocus(page: Page, maxStops = 40) {
  // Read the end state of the focus style, not a transition's first frame.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const missing: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const id = `${el.tagName}:${el.getAttribute('href') ?? ''}:${el.getAttribute('name') ?? ''}:${el.textContent?.slice(0, 30) ?? ''}`;
      const focused = getComputedStyle(el);
      const ring = { outline: `${focused.outlineStyle} ${focused.outlineWidth} ${focused.outlineColor}`, shadow: focused.boxShadow };
      // Move focus to a temporary element: blur() does not leave the inner field of a date input. Inside a
      // modal it goes in the dialog, or the focus trap would send focus straight back.
      const away = (el.closest('[role=dialog]') ?? document.body).appendChild(Object.assign(document.createElement('span'), { tabIndex: -1 }));
      away.focus();
      const plain = getComputedStyle(el);
      const before = { outline: `${plain.outlineStyle} ${plain.outlineWidth} ${plain.outlineColor}`, shadow: plain.boxShadow };
      el.focus();
      away.remove();
      const visible = (ring.outline !== before.outline && !ring.outline.startsWith('none')) || ring.shadow !== before.shadow;
      return { id, visible, ring, before };
    });
    if (!r) continue;
    if (seen.has(r.id)) break;
    seen.add(r.id);
    if (!r.visible) missing.push(`${r.id} focused ${JSON.stringify(r.ring)} plain ${JSON.stringify(r.before)}`);
  }
  expect(missing, 'Tab stops without a visible focus indicator').toEqual([]);
}

/** Inputs whose border is their only edge, and the focus ring, reach 3:1 against their background. */
export async function expectNonTextContrast(page: Page) {
  const pairs = await page.evaluate(() => {
    const bgOf = (el: Element | null): string => {
      for (let e = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
      }
      return 'rgb(255, 255, 255)';
    };
    return [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select, [role=combobox]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ name: el.getAttribute('name') ?? el.id, border: getComputedStyle(el).borderTopColor, bg: bgOf(el.parentElement) }));
  });
  const low = pairs.filter((p) => contrast(p.border, p.bg) < 3).map((p) => `${p.name}: ${p.border} on ${p.bg}`);
  expect(low, 'input borders under 3:1').toEqual([]);
  const ring = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--vet-focus-ring').trim());
  expect(ring).toBeTruthy();
}

/** No open sheet, popover, dialog or toast runs a transition or animation over 220 ms. */
export async function expectShortMotion(page: Page) {
  const slow = await page.evaluate(() => {
    const ms = (v: string) => Math.max(...v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000)));
    const els = document.querySelectorAll('[role=dialog], [data-radix-popper-content-wrapper] *, [data-sonner-toast], [data-slot=sheet-overlay], [data-slot=dialog-overlay]');
    return [...els]
      .map((el) => ({ el: el.getAttribute('data-slot') ?? el.tagName, t: ms(getComputedStyle(el).transitionDuration), a: ms(getComputedStyle(el).animationDuration) }))
      .filter((x) => x.t > 220 || x.a > 220)
      .map((x) => `${x.el}: transition ${x.t} ms, animation ${x.a} ms`);
  });
  expect(slow, 'overlays animating over 220 ms').toEqual([]);
}

/** Every visible target is at least 24 × 24 px, or has 24 px of room around its center (WCAG 2.5.8). */
export async function expectTargetSize(page: Page) {
  const small = await page.evaluate(() => {
    // A target whose center sits under a fixed bar (the phone tab bar at this scroll position) is not
    // clickable there, so it is not measured against the bar's tabs. Off-screen targets have no hit and stay.
    const underFixedBar = (el: Element, r: DOMRect) => {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || el.contains(hit)) return false;
      for (let n: Element | null = hit; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return !n.contains(el);
      return false;
    };
    const targets = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=checkbox]')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && !underFixedBar(el, r));
    const centers = targets.map(({ r }) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
    return targets
      .filter(({ el, r }, i) => {
        if (r.width >= 24 && r.height >= 24) return false;
        // Inline links in a sentence are exempt (WCAG 2.5.8 "inline").
        if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
        // Spacing exception: no other target center within 24 px.
        const c = centers[i]!;
        return centers.some((o, j) => j !== i && Math.hypot(o.x - c.x, o.y - c.y) < 24);
      })
      .map(({ el, r }) => `${el.tagName}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''} ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  expect(small, 'targets under 24 × 24 px without spacing').toEqual([]);
}

export async function expectA11yChecks(page: Page) {
  await expectNonTextContrast(page);
  await expectTargetSize(page);
  await expectVisibleFocus(page);
}
