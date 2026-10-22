#!/usr/bin/env bash
# Prints the active shop ads of the given pages, one JSON line each with the thumbnail as base64, for
# analyze.mjs. Read-only: a select through psql and S3 GETs. Run on the production host as root:
#   ssh vet-linux "bash -s -- <page_id> ..." < export-ads.sh > out/ads.jsonl
set -euo pipefail
cd /opt/ideas-hub
for id in "$@"; do [[ $id =~ ^[0-9]+$ ]] || { echo "not a page id: $id" >&2; exit 2; }; done
ids=$(printf "'%s'," "$@"); ids=${ids%,}
docker compose -p ideas-hub exec -T postgres psql -U ideashub -d ideashub -AtX -v ON_ERROR_STOP=1 -c "
  select json_build_object('page_id', a.page_id, 'ad_archive_id', a.ad_archive_id, 'caption', a.caption, 'thumbnail_key', a.thumbnail_key)
  from ads a join shops s on s.landing_domain = a.landing_domain
  where a.is_active and a.page_id in ($ids) order by a.page_id, a.ad_archive_id" < /dev/null |
  PATH=/opt/ideas-hub-tools/node/bin:$PATH node --input-type=module -e "
    import { createRequire } from 'node:module';
    import { createInterface } from 'node:readline';
    process.loadEnvFile('/opt/ideas-hub/.env');
    const { S3Client, GetObjectCommand } = createRequire('/opt/ideas-hub/apps/worker/package.json')('@aws-sdk/client-s3');
    const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: 'us-east-1', forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' } });
    for await (const line of createInterface({ input: process.stdin })) {
      const ad = JSON.parse(line);
      if (ad.thumbnail_key) {
        try {
          const o = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'ideas-hub', Key: 'thumbs/' + ad.thumbnail_key }));
          ad.thumb = Buffer.from(await o.Body.transformToByteArray()).toString('base64');
        } catch (e) { ad.thumb = null; ad.thumb_error = String(e.name ?? e).slice(0, 80); }
      }
      console.log(JSON.stringify(ad));
    }"
