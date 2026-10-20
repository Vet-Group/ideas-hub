import { rmSync } from 'node:fs';
import { seedE2e } from './fixtures/seed';

export default async function globalSetup() {
  // The seed rewrites the thumbnails under the same keys; Next's optimizer cache would serve the old ones.
  rmSync(new URL('../.next/cache/images', import.meta.url), { recursive: true, force: true });
  await seedE2e();
}
