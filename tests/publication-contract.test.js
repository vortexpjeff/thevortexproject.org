import test from 'node:test';
import assert from 'node:assert/strict';

import {isUtcTimestamp, publicationRevisionHash, publicationsForPublicOutput, validateEditorialCatalog} from '../publication-contract.js';

const fixture = {
  schema_version: 1,
  publications: [{
    id: 'dispatch-example', revision: 1, editorial_state: 'fixture', title: 'Example',
    summary: 'Example summary', content_type: 'Field Note', stream: 'Methods',
    generated_at: '2026-08-08T00:00:00Z',
    slug: 'example', url: 'https://www.thevortexproject.org/dispatches/example/',
    privacy_state: 'fixture-only', rights_state: 'original-fixture-copy', sources: [],
  }],
};

test('fixture records may build without pretending to have human approval', () => {
  assert.doesNotThrow(() => validateEditorialCatalog(fixture));
});

test('public provenance timestamps require real UTC RFC3339 calendar values', () => {
  assert.equal(isUtcTimestamp('2026-08-08T12:34:56Z'), true);
  assert.equal(isUtcTimestamp('2026-08-08T12:34:56.123Z'), true);
  assert.equal(isUtcTimestamp('2026-99-99Tgarbage'), false);
  assert.equal(isUtcTimestamp('2026-02-30T12:34:56Z'), false);
  assert.equal(isUtcTimestamp('2026-08-08T25:00:00Z'), false);
});

test('publication identifiers must be unique and revisions positive', () => {
  const duplicate = structuredClone(fixture);
  duplicate.publications.push(structuredClone(duplicate.publications[0]));
  assert.throws(() => validateEditorialCatalog(duplicate), /duplicate publication id/i);
  const badRevision = structuredClone(fixture);
  badRevision.publications[0].revision = 0;
  assert.throws(() => validateEditorialCatalog(badRevision), /revision/i);
});

test('approved records require one human approval after recorded automated checks', () => {
  const approved = structuredClone(fixture);
  approved.publications[0].editorial_state = 'approved';
  assert.throws(() => validateEditorialCatalog(approved), /accountable editor/i);
  approved.publications[0].accountable_editor = 'Jeffrey';
  assert.throws(() => validateEditorialCatalog(approved), /primary source/i);
  approved.publications[0].sources = [{url: 'https://example.gov/record', kind: 'primary', title: 'Primary record', retrieved_at: '2026-08-08'}];
  approved.publications[0].evidence_state = 'reviewed source record';
  approved.publications[0].correction_state = 'none';
  assert.throws(() => validateEditorialCatalog(approved), /privacy state/i);
  approved.publications[0].privacy_state = 'public-cleared';
  assert.throws(() => validateEditorialCatalog(approved), /rights state/i);
  approved.publications[0].rights_state = 'public-cleared';
  assert.throws(() => validateEditorialCatalog(approved), /passed review assessment/i);
  approved.publications[0].review_assessment = {
    state: 'checks-passed', checked_at: '2026-08-08T00:00:00Z', checked_by: ['Hermes Athena'],
    claims_basis: 'Primary-source comparison', privacy_basis: 'Public derivative scan', rights_basis: 'Source and usage review',
    sources: ['https://example.gov/record'],
  };
  assert.throws(() => validateEditorialCatalog(approved), /recorded publication approval/i);
  approved.publications[0].publication_approval = {
    state: 'approved', editor: 'Jeffrey', decided_at: '2026-08-08T00:00:00Z', basis: 'Approved exact reviewed revision',
  };
  approved.publications[0].approved_sha256 = publicationRevisionHash(approved.publications[0]);
  assert.doesNotThrow(() => validateEditorialCatalog(approved));
});

test('catalog rejects private-boundary keys and noncanonical publication URLs', () => {
  const privateRecord = structuredClone(fixture);
  privateRecord.publications[0].private_path = '/private/evidence';
  assert.throws(() => validateEditorialCatalog(privateRecord), /private-boundary key/i);
  const wrongHost = structuredClone(fixture);
  wrongHost.publications[0].url = 'https://example.com/dispatch';
  assert.throws(() => validateEditorialCatalog(wrongHost), /canonical public URL/i);
});

test('public machine outputs admit only fully gated public states', () => {
  const catalog = structuredClone(fixture);
  const gated = catalog.publications[0];
  gated.accountable_editor = 'Test editor';
  gated.sources = [{kind: 'primary', url: 'https://example.org/record', title: 'Primary record', retrieved_at: '2026-08-08'}];
  gated.privacy_state = 'public-cleared';
  gated.rights_state = 'public-cleared';
  gated.review_assessment = {
    state: 'checks-passed', checked_at: '2026-08-08T00:00:00Z', checked_by: ['Hermes Athena'],
    claims_basis: 'Primary-source comparison', privacy_basis: 'Public derivative scan', rights_basis: 'Source and usage review',
    sources: ['https://example.org/record'],
  };
  gated.publication_approval = {state: 'approved', editor: 'Test editor', decided_at: '2026-08-08T00:00:00Z', basis: 'Approved exact reviewed revision'};
  gated.evidence_state = 'reviewed source record';
  gated.correction_state = 'none';

  catalog.publications = ['fixture', 'draft', 'review', 'approved', 'released', 'corrected', 'superseded', 'retracted']
    .map((state, index) => {
      const record = {...gated, id: `dispatch-${state}`, slug: state, revision: index + 1, editorial_state: state};
      if (['released', 'corrected', 'superseded', 'retracted'].includes(state)) {
        record.published_at = '2026-08-08T00:00:00Z';
        record.approval_sha256 = 'b'.repeat(64);
      }
      if (['corrected', 'superseded', 'retracted'].includes(state)) {
        record.corrections = [];
        for (let previousRevision = 1; previousRevision < record.revision; previousRevision += 1) {
          const previous = {...gated, id: record.id, slug: record.slug, revision: previousRevision, editorial_state: 'released', published_at: record.published_at, approval_sha256: record.approval_sha256};
          previous.approved_sha256 = publicationRevisionHash(previous);
          record.corrections.push({
            previous_revision: previousRevision,
            previous_revision_sha256: publicationRevisionHash(previous),
            previous_record: previous,
            corrected_at: record.published_at,
            reason: 'State change',
            editor: 'Test editor',
            previous_text: 'Earlier wording',
            replacement_text: 'Current wording',
          });
        }
      }
      if (['approved', 'released', 'corrected', 'superseded', 'retracted'].includes(state)) record.approved_sha256 = publicationRevisionHash(record);
      return record;
    });

  validateEditorialCatalog(catalog);
  const publicRecords = publicationsForPublicOutput(catalog);
  assert.deepEqual(
    publicRecords.map(record => record.editorial_state),
    ['released', 'corrected', 'superseded', 'retracted'],
  );
  assert.equal(JSON.stringify(publicRecords).includes('Test editor'), false);
  assert.ok(publicRecords.every(record => !('accountable_editor' in record) && !('publication_approval' in record) && !('review_assessment' in record)));
});

test('corrected, superseded, and retracted records retain release gates', () => {
  for (const state of ['corrected', 'superseded', 'retracted']) {
    const catalog = structuredClone(fixture);
    catalog.publications[0].editorial_state = state;
    assert.throws(() => validateEditorialCatalog(catalog), /accountable editor/i, state);
  }
});
