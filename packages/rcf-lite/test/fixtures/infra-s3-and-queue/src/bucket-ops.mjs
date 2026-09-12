/**
 * Fixture-hosted bucket-ops helper.
 *
 * Wraps @aws-sdk/client-s3's CreateBucket / DeleteBucket / ListBuckets
 * so the R2 real-account probe can drive scratch-bucket lifecycle
 * against a real Cloudflare R2 account through the fixture's own
 * dependency resolution (rcf-lite has no shipped runtime dep on the
 * SDK; the fixture package declares it).
 */

import { S3Client, CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand } from '@aws-sdk/client-s3';

export function createBucketOps({ endpointUrl, region = 'auto', credentials, forcePathStyle = false }) {
  const client = new S3Client({ endpoint: endpointUrl, region, credentials, forcePathStyle });
  return {
    async createBucket(bucketName) {
      return client.send(new CreateBucketCommand({ Bucket: bucketName }));
    },
    async deleteBucket(bucketName) {
      return client.send(new DeleteBucketCommand({ Bucket: bucketName }));
    },
    async listBuckets() {
      const res = await client.send(new ListBucketsCommand({}));
      return {
        buckets: (res.Buckets || []).map((b) => b.Name),
        raw: res,
      };
    },
    close() {
      client.destroy();
    },
  };
}
