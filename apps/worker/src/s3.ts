// ObjectStore on the S3 API (MinIO in development and on the Linux desktop).
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type ObjectStore } from './context';

export function s3StoreFromEnv(): ObjectStore {
  const bucket = process.env.S3_BUCKET ?? 'ideas-hub';
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
  });
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
      ready ??= ensureBucket();
      await ready;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
  };
}
