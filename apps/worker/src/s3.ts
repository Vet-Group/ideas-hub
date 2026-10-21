// ObjectStore on the S3 API (MinIO in development and on the Linux desktop).
import { CreateBucketCommand, DeleteObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type ObjectStore } from './context';

export function s3StoreFromEnv(): ObjectStore {
  return s3Store(
    new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
    }),
    process.env.S3_BUCKET ?? 'ideas-hub',
  );
}

export function s3Store(client: Pick<S3Client, 'send'>, bucket: string): ObjectStore {
  let ready: Promise<void> | null = null;
  const ensureBucket = async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  };
  return {
    async put(key, body, contentType) {
      // A failed check is not kept, so the next put tries again (MinIO down for a moment).
      ready ??= ensureBucket().catch((e: unknown) => {
        ready = null;
        throw e;
      });
      await ready;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
