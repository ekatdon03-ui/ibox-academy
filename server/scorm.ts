// ─────────────────────────────────────────────────────────────────────────────
// SCORM package handling.
//
// A SCORM package is an archive (ZIP, or TAR/TAR.GZ as some authoring tools and
// LMS exports produce) containing imsmanifest.xml plus the content. We:
//   1. unpack the archive in memory,
//   2. pick the *real* SCORM manifest (some exports wrap the SCORM package in an
//      outer manifest; we prefer the one whose launch file is HTML / a SCO),
//   3. upload the files of that package to S3 under scorm/<id>/…,
//   4. serve the content back through our own origin so the content's
//      window.parent.API discovery works (cross-origin would be blocked).
// ─────────────────────────────────────────────────────────────────────────────
import AdmZip from 'adm-zip';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { uploadBufferToKey, contentTypeFor } from './s3';
import { genId } from './repo';

export interface ScormManifestInfo {
  version: '1.2' | '2004';
  launchHref: string;
  hasSco: boolean;
}

interface PkgEntry { name: string; data: Buffer; }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // adlcp:scormType → scormType, imsss:* → *
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// ── Archive unpacking (ZIP or TAR/TAR.GZ) ───────────────────────────────────
function normName(n: string): string {
  return n.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

// Minimal, dependency-free tar reader. Handles v7 (old Unix), ustar (POSIX),
// GNU long names ('L') and PAX path records ('x'/'g') — covers what authoring
// tools and LMS exports produce. (tar-stream rejects the common v7 format.)
function extractTar(buf: Buffer): PkgEntry[] {
  const out: PkgEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) { if (h[i] !== 0) { allZero = false; break; } }
    if (allZero) break; // end-of-archive marker
    const name = h.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '');
    const size = parseInt(h.subarray(124, 136).toString('latin1').replace(/[^0-7]/g, '') || '0', 8) || 0;
    const typeflag = String.fromCharCode(h[156]);
    const prefix = h.subarray(345, 500).toString('utf8').replace(/\0[\s\S]*$/, '');
    off += 512;
    const data = Buffer.from(buf.subarray(off, off + size));
    off += Math.ceil(size / 512) * 512;
    if (typeflag === 'L') { longName = data.toString('utf8').replace(/\0[\s\S]*$/, ''); continue; }
    if (typeflag === 'x' || typeflag === 'g') {
      const m = data.toString('utf8').match(/\d+ path=([^\n]+)\n/);
      if (m) longName = m[1];
      continue;
    }
    const full = longName || (prefix ? `${prefix}/${name}` : name);
    longName = null;
    // typeflag '0' / NUL / '' = regular file; skip directories ('5') and others.
    if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      out.push({ name: normName(full), data });
    }
  }
  return out;
}

function readZip(buffer: Buffer): PkgEntry[] {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((e) => !e.isDirectory)
    .map((e) => ({ name: normName(e.entryName), data: e.getData() }));
}

async function readArchive(buffer: Buffer, filename = ''): Promise<PkgEntry[]> {
  const lower = filename.toLowerCase();
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b; // gzip magic
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;  // 'PK'

  if (isZip || lower.endsWith('.zip')) {
    try { return readZip(buffer); } catch (e) { if (!isGzip) throw e; }
  }
  if (isGzip || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return extractTar(zlib.gunzipSync(buffer));
  }
  if (lower.endsWith('.tar')) {
    return extractTar(buffer);
  }
  // Unknown extension/magic: try zip, then gzip-tar, then plain tar.
  try { return readZip(buffer); } catch {}
  try { return await extractTar(zlib.gunzipSync(buffer)); } catch {}
  try { return await extractTar(buffer); } catch {}
  throw new Error('Не удалось распаковать архив (поддерживаются .zip, .tar.gz, .tgz, .tar)');
}

// ── Manifest parsing ─────────────────────────────────────────────────────────
function findFirstItemWithRef(org: any): any | null {
  if (!org) return null;
  for (const it of asArray<any>(org.item)) {
    if (it['@_identifierref']) return it;
    const nested = findFirstItemWithRef(it);
    if (nested) return nested;
  }
  return null;
}

function joinPath(base: string, rel: string): string {
  return `${base.replace(/\/$/, '')}/${rel.replace(/^\//, '')}`;
}

// Find launch file, SCORM version, and whether the package has a real SCO.
export function parseManifest(xml: string): ScormManifestInfo {
  const doc = parser.parse(xml);
  const manifest = doc.manifest || {};

  // Version
  let version: '1.2' | '2004' = '1.2';
  const raw = xml.toLowerCase();
  if (raw.includes('2004') || raw.includes('imsss') || raw.includes('adlseq') ||
      raw.includes('adlcp_v1p3') || raw.includes('cam 1.3')) version = '2004';

  // Collect resources across (possibly multiple) <resources> containers, keeping
  // each resource's effective base path (container xml:base + resource xml:base).
  const containers = asArray<any>(manifest.resources);
  const resources: any[] = [];
  for (const c of containers) {
    const cBase = c?.['@_xml:base'] || c?.['@_base'] || '';
    for (const r of asArray<any>(c?.resource)) {
      const rBase = r['@_xml:base'] || r['@_base'] || '';
      resources.push({ ...r, __base: [cBase, rBase].filter(Boolean).join('/').replace(/\/+/g, '/') });
    }
  }
  const scormTypeOf = (r: any) => (r['@_scormType'] || r['@_scormtype'] || '').toLowerCase();
  const hasSco = resources.some((r) => scormTypeOf(r) === 'sco');
  const isHtml = (h: string) => /\.html?($|[?#])/i.test(h || '');

  // Prefer the resource referenced by the default organization's first item;
  // then a SCO with an href, then any HTML resource, then any resource.
  let chosen: any = null;
  const orgs = manifest.organizations;
  const defaultOrgId = orgs?.['@_default'];
  const orgList = asArray<any>(orgs?.organization);
  const defaultOrg = orgList.find((o) => o['@_identifier'] === defaultOrgId) || orgList[0];
  const firstItem = findFirstItemWithRef(defaultOrg);
  if (firstItem) {
    const ref = firstItem['@_identifierref'];
    const res = resources.find((r) => r['@_identifier'] === ref && r['@_href']);
    if (res) chosen = res;
  }
  if (!chosen) {
    chosen = resources.find((r) => scormTypeOf(r) === 'sco' && r['@_href'])
      || resources.find((r) => isHtml(r['@_href']))
      || resources.find((r) => r['@_href']);
  }

  let launch = chosen?.['@_href'] || '';
  if (chosen?.__base && launch) launch = joinPath(chosen.__base, launch);
  if (!launch) launch = 'index.html';
  launch = normName(launch);
  return { version, launchHref: launch, hasSco };
}

export interface ScormImportResult {
  id: string;
  title: string;
  version: '1.2' | '2004';
  launchHref: string;
  s3Prefix: string;
  fileCount: number;
}

// Unpack a SCORM archive, upload its files to S3, return package metadata.
export async function importScormArchive(
  buffer: Buffer,
  filename = '',
  titleHint?: string
): Promise<ScormImportResult> {
  const entries = await readArchive(buffer, filename);

  const manifestEntries = entries.filter((e) => /(^|\/)imsmanifest\.xml$/i.test(e.name));
  if (!manifestEntries.length) throw new Error('imsmanifest.xml не найден — это не похоже на SCORM-пакет');

  // Some exports wrap the real SCORM package in an outer manifest. Score each
  // candidate and keep the best: HTML launch (+2) and a real SCO (+1) win.
  let best: { folder: string; info: ScormManifestInfo; score: number } | null = null;
  for (const m of manifestEntries) {
    const folder = m.name.replace(/imsmanifest\.xml$/i, ''); // '' or 'scorm/'
    let info: ScormManifestInfo;
    try { info = parseManifest(m.data.toString('utf8')); } catch { continue; }
    const isHtml = /\.html?($|[?#])/i.test(info.launchHref);
    const score = (isHtml ? 2 : 0) + (info.hasSco ? 1 : 0);
    if (!best || score > best.score) best = { folder, info, score };
  }
  if (!best) throw new Error('Не удалось разобрать манифест SCORM');

  const { folder: rootPrefix, info } = best;
  const id = genId('scorm_');
  const s3Prefix = `scorm/${id}/`;

  // Collect the files belonging to the chosen package (its folder).
  const toUpload: { key: string; data: Buffer; ct: string }[] = [];
  for (const e of entries) {
    if (rootPrefix && !e.name.startsWith(rootPrefix)) continue;
    if (/(^|\/)__MACOSX\//.test(e.name) || /(^|\/)\.DS_Store$/.test(e.name)) continue;
    const rel = rootPrefix ? e.name.slice(rootPrefix.length) : e.name;
    if (!rel) continue;
    toUpload.push({ key: `${s3Prefix}${rel}`, data: e.data, ct: contentTypeFor(rel) });
  }
  if (toUpload.length === 0) throw new Error('SCORM-пакет пустой или повреждён');

  // Upload to S3 with limited concurrency (packages often have hundreds of files).
  const CONCURRENCY = 8;
  let next = 0;
  async function worker() {
    while (next < toUpload.length) {
      const item = toUpload[next++];
      await uploadBufferToKey(item.key, item.data, item.ct);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toUpload.length) }, worker));
  const fileCount = toUpload.length;

  return {
    id,
    title: titleHint?.trim() || 'SCORM-курс',
    version: info.version,
    launchHref: info.launchHref,
    s3Prefix,
    fileCount,
  };
}
