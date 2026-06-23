// ─────────────────────────────────────────────────────────────────────────────
// SCORM package handling.
//
// A SCORM package is a ZIP containing imsmanifest.xml at the root plus the
// content (HTML/JS/media). We:
//   1. parse the manifest to find the launch file and SCORM version,
//   2. upload every file to S3 under scorm/<id>/…,
//   3. serve the content back through our own origin (so the content's
//      window.parent.API discovery works — cross-origin would be blocked).
// ─────────────────────────────────────────────────────────────────────────────
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { uploadBufferToKey, contentTypeFor } from './s3';
import { genId } from './repo';

export interface ScormManifestInfo {
  version: '1.2' | '2004';
  launchHref: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true, // treat adlcp:scormType as scormType, imsss:* as *
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// Find the launch file + SCORM version from imsmanifest.xml contents.
export function parseManifest(xml: string): ScormManifestInfo {
  const doc = parser.parse(xml);
  const manifest = doc.manifest || {};

  // ── Version ────────────────────────────────────────────────────────────────
  let version: '1.2' | '2004' = '1.2';
  const schema = JSON.stringify(manifest.metadata || {}).toLowerCase();
  if (schema.includes('2004') || schema.includes('cam 1.3') || schema.includes('1.3')) version = '2004';
  // Namespace hint: SCORM 2004 manifests carry imsss / adlseq sequencing.
  const raw = xml.toLowerCase();
  if (raw.includes('imsss') || raw.includes('adlseq') || raw.includes('2004')) version = '2004';

  // ── Launch file ──────────────────────────────────────────────────────────
  const resources = asArray<any>(manifest.resources?.resource);
  // Prefer the SCO that the default organization points at; fall back to the
  // first resource that has an href.
  let launch = '';

  const orgs = manifest.organizations;
  const defaultOrgId = orgs?.['@_default'];
  const orgList = asArray<any>(orgs?.organization);
  const defaultOrg = orgList.find((o) => o['@_identifier'] === defaultOrgId) || orgList[0];

  const firstItem = findFirstItemWithRef(defaultOrg);
  if (firstItem) {
    const ref = firstItem['@_identifierref'];
    const res = resources.find((r) => r['@_identifier'] === ref);
    if (res?.['@_href']) launch = res['@_href'];
  }

  if (!launch) {
    const withHref = resources.find((r) => r['@_href']);
    if (withHref) launch = withHref['@_href'];
  }

  // xml:base on <resources> or <resource> prepends to the href.
  const resourcesBase = manifest.resources?.['@_base'] || manifest.resources?.['@_xml:base'] || '';
  if (resourcesBase && launch) launch = joinPath(resourcesBase, launch);

  if (!launch) launch = 'index.html';
  // Normalise: strip leading "./" and any leading slash; drop query/hash for the key.
  launch = launch.replace(/^\.\//, '').replace(/^\//, '');

  return { version, launchHref: launch };
}

function findFirstItemWithRef(org: any): any | null {
  if (!org) return null;
  const items = asArray<any>(org.item);
  for (const it of items) {
    if (it['@_identifierref']) return it;
    const nested = findFirstItemWithRef(it);
    if (nested) return nested;
  }
  return null;
}

function joinPath(base: string, rel: string): string {
  return `${base.replace(/\/$/, '')}/${rel.replace(/^\//, '')}`;
}

export interface ScormImportResult {
  id: string;
  title: string;
  version: '1.2' | '2004';
  launchHref: string;
  s3Prefix: string;
  fileCount: number;
}

// Unzip a SCORM package buffer, upload its files to S3, return package metadata.
export async function importScormZip(zipBuffer: Buffer, titleHint?: string): Promise<ScormImportResult> {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  const manifestEntry = entries.find((e) => /(^|\/)imsmanifest\.xml$/i.test(e.entryName));
  if (!manifestEntry) throw new Error('imsmanifest.xml не найден — это не похоже на SCORM-пакет');

  // Manifest may sit in a sub-folder; everything is relative to that folder.
  const rootPrefix = manifestEntry.entryName.replace(/imsmanifest\.xml$/i, ''); // '' or 'folder/'
  const manifestXml = manifestEntry.getData().toString('utf8');
  const info = parseManifest(manifestXml);

  const id = genId('scorm_');
  const s3Prefix = `scorm/${id}/`;

  let fileCount = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    // Skip macOS archive junk that adds no value and can confuse players.
    if (/(^|\/)__MACOSX\//.test(e.entryName) || /(^|\/)\.DS_Store$/.test(e.entryName)) continue;
    // Strip the manifest's root folder so paths are relative to the launch file.
    let rel = e.entryName;
    if (rootPrefix && rel.startsWith(rootPrefix)) rel = rel.slice(rootPrefix.length);
    if (!rel) continue;
    const key = `${s3Prefix}${rel}`;
    await uploadBufferToKey(key, e.getData(), contentTypeFor(rel));
    fileCount++;
  }
  if (fileCount === 0) throw new Error('SCORM-пакет пустой или повреждён');

  return {
    id,
    title: titleHint?.trim() || 'SCORM-курс',
    version: info.version,
    launchHref: info.launchHref,
    s3Prefix,
    fileCount,
  };
}
