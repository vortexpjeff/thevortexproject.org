import {createHash} from 'node:crypto';

const EDITORIAL_STATES = new Set([
  'fixture', 'draft', 'review', 'approved', 'released', 'corrected', 'superseded', 'retracted',
]);
const PUBLIC_STATES = new Set(['released', 'corrected', 'superseded', 'retracted']);
const GATED_STATES = new Set(['approved', ...PUBLIC_STATES]);
const PRIVATE_KEYS = new Set([
  'private_path', 'private_host', 'hostname', 'token', 'password', 'credentials',
  'latitude', 'longitude', 'lat', 'lon', 'coordinates', 'raw_audio', 'raw_media',
]);
const CANONICAL_ORIGIN = 'https://www.thevortexproject.org';

function canonicalize(value, depth = 0) {
  if (Array.isArray(value)) return value.map(child => canonicalize(child, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter(key => !(depth === 0 && key === 'approved_sha256'))
    .sort()
    .map(key => [key, canonicalize(value[key], depth + 1)]));
}

export function publicationRevisionHash(record) {
  return createHash('sha256').update(JSON.stringify(canonicalize(record))).digest('hex');
}

export function completeEvidenceHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value, 1))).digest('hex');
}

function requireText(record, key, label = key) {
  if (typeof record[key] !== 'string' || !record[key].trim()) {
    throw new Error(`${record.id || 'publication'} requires ${label}`);
  }
}

export function isUtcTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(value || '');
  if (!match) return false;
  const [, year, month, day, hour, minute, second, milliseconds = '000'] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}Z`;
  const parsed = new Date(normalized);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === normalized;
}

function isCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && isUtcTimestamp(`${value}T00:00:00Z`);
}

function validateClearance(record, key, label) {
  const clearance = record[key];
  if (!clearance || clearance.state !== 'public-cleared') throw new Error(`${record.id} requires recorded ${label} clearance`);
  const allowed = new Set(['state', 'reviewer', 'decided_at', 'basis']);
  const unsupported = Object.keys(clearance).find(field => !allowed.has(field));
  if (unsupported) throw new Error(`${record.id} has unsupported ${label} clearance field: ${unsupported}`);
  requireText(clearance, 'reviewer', `${label} clearance reviewer`);
  requireText(clearance, 'basis', `${label} clearance basis`);
  if (!isUtcTimestamp(clearance.decided_at)) throw new Error(`${record.id} requires valid ${label} clearance timestamp`);
  if (clearance.reviewer.trim().toLowerCase() === record.accountable_editor.trim().toLowerCase()) {
    throw new Error(`${record.id} ${label} clearance reviewer must be independent from accountable editor`);
  }
  return clearance;
}

function checkPrivateKeys(value, trail = 'catalog') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) {
      throw new Error(`private-boundary key is not allowed in public catalog: ${trail}.${key}`);
    }
    checkPrivateKeys(child, `${trail}.${key}`);
  }
}

export function validateEditorialCatalog(catalog) {
  if (!catalog || catalog.schema_version !== 1 || !Array.isArray(catalog.publications)) {
    throw new Error('editorial catalog must use schema_version 1 with a publications array');
  }
  checkPrivateKeys(catalog);

  const ids = new Set();
  for (const record of catalog.publications) {
    requireText(record, 'id', 'stable publication id');
    if (ids.has(record.id)) throw new Error(`duplicate publication id: ${record.id}`);
    ids.add(record.id);
    if (!Number.isInteger(record.revision) || record.revision < 1) {
      throw new Error(`${record.id} revision must be a positive integer`);
    }
    requireText(record, 'title');
    requireText(record, 'summary');
    requireText(record, 'content_type', 'content type');
    requireText(record, 'stream');
    requireText(record, 'generated_at', 'generated timestamp');
    if (!isUtcTimestamp(record.generated_at)) throw new Error(`${record.id} requires valid generated_at timestamp`);
    requireText(record, 'slug');
    if (!EDITORIAL_STATES.has(record.editorial_state)) {
      throw new Error(`${record.id} has unsupported editorial state: ${record.editorial_state}`);
    }
    let url;
    try {
      url = new URL(record.url);
    } catch {
      throw new Error(`${record.id} requires a canonical public URL`);
    }
    if (url.origin !== CANONICAL_ORIGIN || !url.pathname.startsWith('/dispatches/')) {
      throw new Error(`${record.id} requires a canonical public URL`);
    }
    if (!Array.isArray(record.sources)) throw new Error(`${record.id} sources must be an array`);

    if (GATED_STATES.has(record.editorial_state)) {
      requireText(record, 'accountable_editor', 'accountable editor');
      if (!record.sources.some(source => source?.kind === 'primary' && /^https:\/\//.test(source?.url || ''))) {
        throw new Error(`${record.id} requires at least one HTTPS primary source`);
      }
      for (const source of record.sources) {
        requireText(source, 'title', 'source title');
        if (!isCalendarDate(source.retrieved_at)) {
          throw new Error(`${record.id} source requires retrieved_at date`);
        }
      }
      requireText(record, 'evidence_state', 'evidence state');
      requireText(record, 'correction_state', 'correction state');
      if (record.privacy_state !== 'public-cleared') {
        throw new Error(`${record.id} privacy state must be public-cleared`);
      }
      if (record.rights_state !== 'public-cleared') {
        throw new Error(`${record.id} rights state must be public-cleared`);
      }
      const privacyClearance = validateClearance(record, 'privacy_clearance', 'privacy');
      const rightsClearance = validateClearance(record, 'rights_clearance', 'rights');
      if (privacyClearance.reviewer.trim().toLowerCase() === rightsClearance.reviewer.trim().toLowerCase()) {
        throw new Error(`${record.id} privacy and rights clearances require separate reviewers`);
      }
      if (!/^[a-f0-9]{64}$/.test(record.approved_sha256 || '') || record.approved_sha256 !== publicationRevisionHash(record)) {
        throw new Error(`${record.id} approved revision hash does not match content`);
      }
      if (PUBLIC_STATES.has(record.editorial_state) && !isUtcTimestamp(record.published_at)) {
        throw new Error(`${record.id} requires published_at timestamp`);
      }
      if (PUBLIC_STATES.has(record.editorial_state) && !/^[a-f0-9]{64}$/.test(record.approval_sha256 || '')) {
        throw new Error(`${record.id} requires the retained approval hash`);
      }
      if (['corrected', 'superseded', 'retracted'].includes(record.editorial_state)
          && (!Array.isArray(record.corrections) || record.corrections.length === 0)) {
        throw new Error(`${record.id} requires correction history`);
      }
      if (['corrected', 'superseded', 'retracted'].includes(record.editorial_state)) {
        if (record.revision < 2) throw new Error(`${record.id} correction state requires revision 2 or later`);
        if (record.corrections.length !== record.revision - 1) {
          throw new Error(`${record.id} correction history must be contiguous from revision 1`);
        }
        for (const [index, correction] of record.corrections.entries()) {
          if (correction.previous_revision !== index + 1 || correction.previous_revision >= record.revision) {
            throw new Error(`${record.id} correction requires a prior revision number`);
          }
          if (!/^[a-f0-9]{64}$/.test(correction.previous_revision_sha256 || '')) {
            throw new Error(`${record.id} correction requires a prior revision hash`);
          }
          if (!isUtcTimestamp(correction.corrected_at)) {
            throw new Error(`${record.id} correction requires corrected_at timestamp`);
          }
          requireText(correction, 'reason', 'correction reason');
          requireText(correction, 'editor', 'correction editor');
          requireText(correction, 'previous_text', 'previous wording');
          requireText(correction, 'replacement_text', 'replacement wording');
          if (!correction.previous_record || correction.previous_record.id !== record.id
              || correction.previous_record.revision !== correction.previous_revision
              || !PUBLIC_STATES.has(correction.previous_record.editorial_state)
              || publicationRevisionHash(correction.previous_record) !== correction.previous_revision_sha256
              || correction.previous_record.approved_sha256 !== publicationRevisionHash(correction.previous_record)) {
            throw new Error(`${record.id} correction must embed the hashed prior public revision`);
          }
        }
      }
    }
  }
  return catalog;
}

export function publicationsForPublicOutput(catalog) {
  return catalog.publications.filter(record => PUBLIC_STATES.has(record.editorial_state));
}
