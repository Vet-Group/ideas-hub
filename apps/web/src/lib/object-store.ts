import 'server-only';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Thumbnails and idea images in MinIO, on the same variables as the worker (apps/worker/src/s3.ts).
export interface ObjectStore {
  /** Null when the object does not exist. */
  getObject(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string | undefined; contentLength: number | undefined } | null>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObjects(keys: readonly string[]): Promise<void>;
}

function s3Store(): ObjectStore {
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });
  const bucket = process.env.S3_BUCKET ?? 'ideas-hub';
  let ready: Promise<void> | null = null;
  const ensureBucket = async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  };
  return {
    async getObject(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!r.Body) return null;
        return { body: r.Body.transformToWebStream(), contentType: r.ContentType, contentLength: r.ContentLength };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    async putObject(key, body, contentType) {
      // A failed check is not kept, so the next put tries again (MinIO down for a moment).
      ready ??= ensureBucket().catch((e: unknown) => {
        ready = null;
        throw e;
      });
      await ready;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async deleteObjects(keys) {
      // One DeleteObject per key: a save writes one object per store, and it avoids DeleteObjects' checksum header.
      await Promise.all(keys.map((key) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))));
    },
  };
}

const g = globalThis as unknown as { ihObjectStore?: ObjectStore };
export const objectStore: ObjectStore = (g.ihObjectStore ??= s3Store());
