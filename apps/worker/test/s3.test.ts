import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { s3Store } from '../src/s3';

describe('s3Store', () => {
  it('checks the bucket again after a failed check instead of failing every later put', async () => {
    let up = false;
    const sent: string[] = [];
    const client = {
      send: async (cmd: unknown) => {
        const name = cmd instanceof HeadBucketCommand ? 'head' : cmd instanceof CreateBucketCommand ? 'create' : cmd instanceof PutObjectCommand ? 'put' : '?';
        sent.push(name);
        if (!up) throw new Error('connect ECONNREFUSED');
        return {};
      },
    } as unknown as Parameters<typeof s3Store>[0];
    const store = s3Store(client, 'b');
    await expect(store.put('k', Buffer.from('x'), 'image/jpeg')).rejects.toThrow('ECONNREFUSED');
    up = true;
    await store.put('k', Buffer.from('x'), 'image/jpeg');
    await store.put('k2', Buffer.from('x'), 'image/jpeg');
    expect(sent).toEqual(['head', 'create', 'head', 'put', 'put']);
  });
});
