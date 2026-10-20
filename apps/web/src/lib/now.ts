// Server-side "now". The e2e harness sets IDEAS_HUB_FIXED_NOW (an ISO instant) to freeze it, with the
// browser clock frozen by Playwright, so screenshots and relative dates do not move (plan Step 5).
export function now(): Date {
  const fixed = process.env.IDEAS_HUB_FIXED_NOW;
  return fixed ? new Date(fixed) : new Date();
}
