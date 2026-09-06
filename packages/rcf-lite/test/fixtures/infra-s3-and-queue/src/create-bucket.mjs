/**
 * One-shot bucket creation for the fixture.
 *
 * Creates the elicited bucket (default rcf-test) against MinIO if it
 * does not already exist. Idempotent.
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { endpointFromEnv, credentialsFromShim } from './object-store.mjs';
import { secretsShim } from './secrets.mjs';

const { endpoint, bucket, region, forcePathStyle } = endpointFromEnv();
const credentials = await credentialsFromShim(secretsShim);
const client = new S3Client({ endpoint, region, credentials, forcePathStyle });

try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  process.stdout.write(`bucket ${bucket} already exists at ${endpoint}\n`);
} catch (headErr) {
  const status = headErr && headErr.$metadata && headErr.$metadata.httpStatusCode;
  if (status !== 404 && headErr && headErr.name !== 'NotFound' && headErr.name !== 'NoSuchBucket') {
    // MinIO returns 404 as NotFound; proceed to create when unclear
  }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  process.stdout.write(`bucket ${bucket} created at ${endpoint}\n`);
}
client.destroy();
