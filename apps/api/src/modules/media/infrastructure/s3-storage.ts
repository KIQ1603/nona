import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../../../config/env';
import type { ObjectStorage } from '../domain';

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(private readonly env: Env) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      requestHandler: { requestTimeout: 10_000, connectionTimeout: 3_000 } as never,
    });
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
  }

  async get(key: string) {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      );
      if (!res.Body) return null;
      return {
        body: Buffer.from(await res.Body.transformToByteArray()),
        contentType: res.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async ensureReady() {
    if (this.env.NODE_ENV === 'production') return; // production buckets are provisioned by infrastructure
    const Bucket = this.env.S3_BUCKET;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket }));
    }
    // Product images and published-article images are public by design; designs/ stays private and
    // uploads remain write-protected by credentials. Production buckets need the same policy.
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: '*',
              Action: ['s3:GetObject'],
              Resource: [
                `arn:aws:s3:::${Bucket}/products/*`,
                `arn:aws:s3:::${Bucket}/articles/*`,
                `arn:aws:s3:::${Bucket}/custom/*`,
              ],
            },
          ],
        }),
      }),
    );
  }
}
