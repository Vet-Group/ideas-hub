'use client';

/**
 * The checkbox behind the "Bộ lọc" toggle (filter-rail.tsx). It looks like a button, so Enter toggles it
 * like Space; left alone, Enter on a checkbox submits the form with the folded fields.
 */
export function FilterToggle() {
  return (
    <input
      id="f-toggle"
      type="checkbox"
      className="peer sr-only xl:hidden"
      aria-controls="f-fields"
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.currentTarget.click();
      }}
    />
  );
}
