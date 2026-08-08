import {completeEvidenceHash, publicationRevisionHash, validateEditorialCatalog} from './publication-contract.js';

const NEW_RECORD_STATES = new Set(['fixture', 'draft', 'review']);
const TRANSITIONS = new Set([
  'fixture:review', 'draft:review', 'review:approved', 'approved:released',
  'released:corrected', 'released:superseded', 'released:retracted',
  'corrected:corrected', 'corrected:superseded', 'corrected:retracted',
]);
const LIFECYCLE_KEYS = new Set([
  'editorial_state', 'accountable_editor', 'approved_sha256', 'approval_sha256',
  'published_at', 'corrections', 'privacy_state', 'rights_state', 'publication_approval',
]);

function contentView(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !LIFECYCLE_KEYS.has(key)));
}

function equalContent(left, right) {
  return publicationRevisionHash(contentView(left)) === publicationRevisionHash(contentView(right));
}

export function validateCatalogTransition(beforeCatalog, afterCatalog) {
  validateEditorialCatalog(afterCatalog);
  const before = new Map((beforeCatalog?.publications || []).map(record => [record.id, record]));
  const afterIds = new Set(afterCatalog.publications.map(record => record.id));

  for (const previous of before.values()) {
    if (!afterIds.has(previous.id) && ['approved', 'released', 'corrected', 'superseded', 'retracted'].includes(previous.editorial_state)) {
      throw new Error(`${previous.id} gated publication history cannot be deleted`);
    }
  }

  for (const record of afterCatalog.publications) {
    const previous = before.get(record.id);
    if (!previous) {
      if (!NEW_RECORD_STATES.has(record.editorial_state)) {
        throw new Error(`${record.id} cannot enter history directly as ${record.editorial_state}`);
      }
      continue;
    }

    if (record.editorial_state === previous.editorial_state) {
      if (['approved', 'released', 'corrected', 'superseded', 'retracted'].includes(record.editorial_state)
          && publicationRevisionHash(record) !== publicationRevisionHash(previous)) {
        throw new Error(`${record.id} gated revision cannot change without a state transition`);
      }
      continue;
    }

    const transition = `${previous.editorial_state}:${record.editorial_state}`;
    if (!TRANSITIONS.has(transition)) throw new Error(`${record.id} invalid editorial transition ${transition}`);

    if (transition === 'review:approved') {
      if (record.revision !== previous.revision || !equalContent(previous, record)) {
        throw new Error(`${record.id} approval must preserve the reviewed content and revision`);
      }
    } else if (transition === 'approved:released') {
      if (record.revision !== previous.revision || !equalContent(previous, record)) {
        throw new Error(`${record.id} release must preserve the approved content and revision`);
      }
      if (record.accountable_editor !== previous.accountable_editor) {
        throw new Error(`${record.id} release cannot replace the approving editor`);
      }
      if (record.approval_sha256 !== previous.approved_sha256) {
        throw new Error(`${record.id} release must retain the exact approved revision hash`);
      }
    } else {
      if (record.revision !== previous.revision + 1) {
        throw new Error(`${record.id} correction transition must increment revision exactly once`);
      }
      if (record.approval_sha256 !== previous.approval_sha256) {
        throw new Error(`${record.id} correction must retain the original approval hash`);
      }
      if (record.privacy_state !== previous.privacy_state
          || record.rights_state !== previous.rights_state
          || completeEvidenceHash(record.review_assessment) !== completeEvidenceHash(previous.review_assessment)
          || completeEvidenceHash(record.publication_approval) !== completeEvidenceHash(previous.publication_approval)) {
        throw new Error(`${record.id} correction must retain the review assessment and publication approval evidence`);
      }
      const priorHistory = previous.corrections || [];
      const retainedHistory = (record.corrections || []).slice(0, -1);
      if (publicationRevisionHash(priorHistory) !== publicationRevisionHash(retainedHistory)) {
        throw new Error(`${record.id} correction cannot rewrite prior correction history`);
      }
      const entry = record.corrections?.at(-1);
      if (!entry || entry.previous_revision_sha256 !== publicationRevisionHash(previous)
          || publicationRevisionHash(entry.previous_record) !== entry.previous_revision_sha256) {
        throw new Error(`${record.id} correction must embed and hash the immediately prior released record`);
      }
    }
  }
  return afterCatalog;
}
