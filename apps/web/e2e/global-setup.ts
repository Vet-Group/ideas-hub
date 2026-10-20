import { seedE2e } from './fixtures/seed';

export default async function globalSetup() {
  await seedE2e();
}
