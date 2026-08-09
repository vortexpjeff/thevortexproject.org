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

function validateReviewAssessment(record) {
  const assessment = record.review_assessment;
  if (!assessment || assessment.state !== 'checks-passed') throw new Error(`${record.id} requires a passed review assessment`);
  const allowed = new Set(['state', 'checked_at', 'checked_by', 'claims_basis', 'privacy_basis', 'rights_basis', 'sources']);
  const unsupported = Object.keys(assessment).find(field => !allowed.has(field));
  if (unsupported) throw new Error(`${record.id} has unsupported review assessment field: ${unsupported}`);
  if (!isUtcTimestamp(assessment.checked_at)) throw new Error(`${record.id} requires a valid review assessment timestamp`);
  if (!Array.isArray(assessment.checked_by) || assessment.checked_by.length === 0
      || assessment.checked_by.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error(`${record.id} review assessment requires checked_by identities`);
  }
  for (const field of ['claims_basis', 'privacy_basis', 'rights_basis']) requireText(assessment, field, field.replace('_', ' '));
  if (!Array.isArray(assessment.sources) || assessment.sources.length === 0
      || assessment.sources.some(url => typeof url !== 'string' || !/^https:\/\//.test(url))) {
    throw new Error(`${record.id} review assessment requires HTTPS sources`);
  }
  const publicationSources = new Set((record.sources || []).map(source => source?.url));
  if (assessment.sources.some(url => !publicationSources.has(url))) {
    throw new Error(`${record.id} review assessment source must be present in publication sources`);
  }
  return assessment;
}

function validatePublicationApproval(record) {
  const approval = record.publication_approval;
  if (!approval || approval.state !== 'approved') throw new Error(`${record.id} requires recorded publication approval`);
  const allowed = new Set(['state', 'editor', 'decided_at', 'basis']);
  const unsupported = Object.keys(approval).find(field => !allowed.has(field));
  if (unsupported) throw new Error(`${record.id} has unsupported publication approval field: ${unsupported}`);
  requireText(approval, 'editor', 'publication approval editor');
  requireText(approval, 'basis', 'publication approval basis');
  if (!isUtcTimestamp(approval.decided_at)) throw new Error(`${record.id} requires valid publication approval timestamp`);
  if (approval.editor !== record.accountable_editor) throw new Error(`${record.id} publication approval editor must match accountable editor`);
  return approval;
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
    if (record.review_assessment !== undefined) validateReviewAssessment(record);

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
      validateReviewAssessment(record);
      validatePublicationApproval(record);
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
  const internalKeys = new Set([
    'accountable_editor', 'publication_approval', 'review_assessment',
    'privacy_clearance', 'rights_clearance', 'editor', 'reviewer',
  ]);
  const redact = value => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !internalKeys.has(key))
      .map(([key, child]) => [key, redact(child)]));
  };
  return catalog.publications.filter(record => PUBLIC_STATES.has(record.editorial_state)).map(record => ({
    ...redact(record),
    evidence_state: 'Claim, privacy, and rights checks passed; human-approved for publication.',
  }));
}
