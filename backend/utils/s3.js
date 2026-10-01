import { S3Client } from '@aws-sdk/client-s3';

// One S3 client for every upload (logo, profile photos, activity media,
// certificates). Previously each file built its own client from AWS_REGION,
// and .env.example shipped AWS_REGION=us-east-1 — a bucket in ap-south-1
// (Mumbai) then failed uploads with a region mismatch AND every stored URL
// pointed at the wrong regional endpoint.
//   AWS_S3_REGION wins if set (lets the bucket region differ from anything
//   else using AWS_REGION); followRegionRedirects makes the SDK retry
//   against the bucket's real region instead of failing.
export const S3_REGION = process.env.AWS_S3_REGION || process.env.AWS_REGION || 'ap-south-1';

export const s3 = new S3Client({
  region: S3_REGION,
  followRegionRedirects: true,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY }
    : undefined, // fall back to the EC2 instance role if no keys are set
});

export function s3PublicUrl(key) {
  return `https://${process.env.AWS_S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}
