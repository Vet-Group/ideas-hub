# Thumbnail size: stored bytes now vs WebP 640 px at quality 75

Date: 2026-10-21. Phase 2 plan Step 2b, ADR 0007 ("Thumbnails"). Measurement only: the stored format
does not change; the decision waits for the pilot.

## Method

- Source: the development bucket (`ideas-hub`, prefix `thumbs/`) on the dev PC's MinIO, read only
  (`ListObjectsV2` and `GetObject`; nothing written back).
- Sample: the keys sorted by name, every 7th key, the first 200 of those, so the sample spans the whole
  bucket and is reproducible.
- For each object: its stored bytes, and the bytes of `sharp(body).resize({ width: 640,
  withoutEnlargement: true }).webp({ quality: 75 })` (sharp 0.35.5, Node 24). 640 px is the widest size
  the web app requests (`next/image` at 320 px, 640 at 2x).

## Results

| | Objects | Stored now | WebP 640 q75 | WebP / now |
|---|---:|---:|---:|---:|
| Whole bucket | 1,555 | 226.5 MB (mean 146 KB) | not measured | |
| Sample | 200 | 32.3 MB (mean 161 KB, median 66 KB) | 7.9 MB (mean 39 KB, median 35 KB) | **24.3%** |
| wider than 640 px | 80 | 25.9 MB | 3.7 MB | 14.1% |
| 640 px or narrower | 120 | 6.3 MB | 4.2 MB | 66.2% |

- Every sampled object is a JPEG (the worker stores JPEG as downloaded); widths 168 to 3,840 px,
  median 600.
- Per object, WebP / now: 10th percentile 17%, median 54%, 90th percentile 73%; no object got larger.
- Most of the saving comes from the 40% of thumbnails wider than 640 px; the format alone saves about a
  third on the rest.

## What it means

- A stored WebP 640 q75 would cut thumbnail bytes by about three quarters (sample: 75.7%). With
  thumbnails at about 87% of the bytes per new ad (ADR 0007: about 146 KB of 160 KB), a new ad would cost
  about 50 KB instead of 160 KB (14.6 KB of rows plus about 36 KB of thumbnail), roughly a third of
  today's growth and of the backup's incremental size. This is an estimate from one sample of the dev
  bucket, not a production measurement.
- The display does not depend on it: `next/image` already serves WebP at 320/640 px to the browser.
- Not changed now (ADR 0007): the stored format is a path the screenshots and AC 7 depend on. After the
  pilot, if the growth matters, the change is `toStoredImage` re-encoding every download to WebP 640 q75,
  plus a one-off pass over existing objects.
