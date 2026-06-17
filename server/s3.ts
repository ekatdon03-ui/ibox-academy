// ─────────────────────────────────────────────────────────────────────────────
// S3-compatible object storage (Timeweb Cloud Storage).
//
// Env vars (set on Render):
//   S3_ENDPOINT      e.g. https://s3.twcstorage.ru
//   S3_REGION        e.g. ru-1
//   S3_BUCKET        bucket name
//   S3_ACCESS_KEY    access key id
//   S3_SECRET_KEY    secret access key
//   S3_PUBLIC_BASE   optional override for the public file URL base
// ─────────────────────────────────────────────────────────────────────────────
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

let client: S3Client | null = null;

export function s3Configured(): boolean {
  return !!(process.env.S3_ENDPOINT && process.env.S3_BUCKET &&
            process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
}

function getClient(): S3Client {
  if (client) return client;
  let endpoint = process.env.S3_ENDPOINT || '';
  if (endpoint && !/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;
  client = new S3Client({
    region: process.env.S3_REGION || 'ru-1',
    endpoint,
    forcePathStyle: true, // Timeweb / most S3-compatible providers
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
  });
  return client;
}

function publicUrl(key: string): string {
  const bucket = process.env.S3_BUCKET!;
  if (process.env.S3_PUBLIC_BASE) {
    return `${process.env.S3_PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
  }
  let endpoint = (process.env.S3_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Path-style public URL: https://<endpoint>/<bucket>/<key>
  return `https://${endpoint}/${bucket}/${key}`;
}

function safeName(name: string): string {
  return (name || 'file')
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
}

/** Upload a buffer to S3 and return the public URL. */
export async function uploadToS3(
  buffer: Buffer,
  originalName: string,
  contentType: string
): Promise<string> {
  const bucket = process.env.S3_BUCKET!;
  const key = `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName(originalName)}`;
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ACL: 'public-read',
  }));
  return publicUrl(key);
}

/** Delete an object by its public URL (best-effort). */
export async function deleteFromS3(url: string): Promise<void> {
  try {
    const bucket = process.env.S3_BUCKET!;
    const marker = `/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const key = url.slice(idx + marker.length);
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e: any) {
    console.warn('[s3] delete failed:', e.message);
  }
}
