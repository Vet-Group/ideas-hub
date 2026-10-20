import { type Locator, type Page } from '@playwright/test';

/**
 * Counts actions as spec §6 defines them: one per mouse click, a drag being one press, and one per key
 * press. Tests drive the page through it and assert the count (e.g. a Lark link opens with 0).
 */
export class Actions {
  count = 0;
  constructor(private page: Page) {}

  async click(target: Locator) {
    this.count += 1;
    await target.click();
  }

  async press(key: string) {
    this.count += 1;
    await this.page.keyboard.press(key);
  }

  async drag(from: Locator, to: Locator) {
    this.count += 1;
    await from.dragTo(to);
  }

  /** Typing a text is one key press per character. */
  async type(target: Locator, text: string) {
    this.count += text.length;
    await target.pressSequentially(text);
  }
}
