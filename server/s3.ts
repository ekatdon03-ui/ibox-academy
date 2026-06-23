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
import {
  S3Client, PutObjectCommand, DeleteObjectCommand, PutBucketCorsCommand,
  GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

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

function newKey(originalName: string): string {
  return `uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName(originalName)}`;
}

/**
 * Create a presigned PUT URL so the browser can upload the file straight to S3
 * (browser → S3, one hop) instead of proxying through our server
 * (browser → Render → S3). Much faster and far more reliable for big PDFs.
 * The client must PUT with the same Content-Type and the x-amz-acl header.
 */
export async function presignUpload(
  originalName: string,
  contentType: string
): Promise<{ uploadUrl: string; publicUrl: string; contentType: string; acl: string }> {
  const bucket = process.env.S3_BUCKET!;
  const key = newKey(originalName);
  const ct = contentType || 'application/octet-stream';
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: ct,
    ACL: 'public-read',
  });
  const uploadUrl = await getSignedUrl(getClient(), cmd, { expiresIn: 3600 });
  return { uploadUrl, publicUrl: publicUrl(key), contentType: ct, acl: 'public-read' };
}

/**
 * Allow the browser to PUT directly to the bucket from any origin. Presigned
 * URLs already require a valid signature, so '*' here is safe. Best-effort:
 * if the provider rejects it, direct upload falls back to the server proxy.
 */
let corsEnsured = false;
export async function ensureBucketCors(): Promise<void> {
  if (corsEnsured || !s3Configured()) return;
  try {
    await getClient().send(new PutBucketCorsCommand({
      Bucket: process.env.S3_BUCKET!,
      CORSConfiguration: {
        CORSRules: [{
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedOrigins: ['*'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        }],
      },
    }));
    corsEnsured = true;
    console.log('[s3] bucket CORS ensured (direct browser upload enabled)');
  } catch (e: any) {
    console.warn('[s3] could not set bucket CORS — direct upload may fall back to proxy:', e.message);
  }
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

// Common file extension → MIME type (for SCORM content served via our proxy).
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  swf: 'application/x-shockwave-flash',
};
export function contentTypeFor(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** Upload a buffer under an explicit key (used for SCORM package files). */
export async function uploadBufferToKey(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET!,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ACL: 'public-read',
  }));
}

/** Fetch an object as a stream (used to proxy SCORM content from our origin). */
export async function getObjectStream(
  key: string
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  const out = await getClient().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
  return {
    stream: out.Body as Readable,
    contentType: out.ContentType,
    contentLength: out.ContentLength,
  };
}

/** Delete every object under a key prefix (best-effort, used when removing a package). */
export async function deletePrefix(prefix: string): Promise<void> {
  try {
    const bucket = process.env.S3_BUCKET!;
    let token: string | undefined;
    do {
      const list = await getClient().send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: token,
      }));
      const objs = (list.Contents || []).map((o) => ({ Key: o.Key! }));
      if (objs.length) {
        await getClient().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs } }));
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  } catch (e: any) {
    console.warn('[s3] deletePrefix failed:', e.message);
  }
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
