import test from 'node:test';
import assert from 'node:assert/strict';

import {publicationRevisionHash} from '../publication-contract.js';
import {validateCatalogTransition} from '../transition-contract.js';

const catalog = publication => ({schema_version: 1, publications: publication ? [publication] : []});
const review = () => ({
  id: 'dispatch-transition', revision: 1, editorial_state: 'review', title: 'Reviewed title',
  summary: 'Reviewed summary', content_type: 'Field Note', stream: 'Methods', generated_at: '2026-08-08T00:00:00Z',
  slug: 'transition', url: 'https://www.thevortexproject.org/dispatches/transition/',
  privacy_state: 'public-cleared', rights_state: 'public-cleared', evidence_state: 'reviewed source', correction_state: 'none',
  privacy_clearance: {state: 'public-cleared', reviewer: 'Privacy reviewer', decided_at: '2026-08-08T00:00:00Z', basis: 'Public derivative inspection'},
  rights_clearance: {state: 'public-cleared', reviewer: 'Rights reviewer', decided_at: '2026-08-08T00:00:00Z', basis: 'Source and license inspection'},
  accountable_editor: null,
  sources: [{kind: 'primary', url: 'https://example.org/record', title: 'Primary record', retrieved_at: '2026-08-08'}],
});
const approve = source => {
  const record = structuredClone(source);
  record.editorial_state = 'approved';
  record.accountable_editor = 'Jeffrey';
  record.approved_sha256 = publicationRevisionHash(record);
  return record;
};
const release = source => {
  const record = structuredClone(source);
  record.editorial_state = 'released';
  record.published_at = '2026-08-08T00:00:00Z';
  record.approval_sha256 = source.approved_sha256;
  record.approved_sha256 = publicationRevisionHash(record);
  return record;
};

test('catalog transition enforces review then exact approval then exact release', () => {
  const reviewed = review();
  const approved = approve(reviewed);
  const released = release(approved);
  assert.doesNotThrow(() => validateCatalogTransition(catalog(reviewed), catalog(approved)));
  assert.doesNotThrow(() => validateCatalogTransition(catalog(approved), catalog(released)));
  assert.throws(() => validateCatalogTransition(catalog(), catalog(released)), /cannot enter history directly/i);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog()), /cannot be deleted/i);

  const changedApproval = approve(reviewed);
  changedApproval.title = 'Changed during approval';
  changedApproval.approved_sha256 = publicationRevisionHash(changedApproval);
  assert.throws(() => validateCatalogTransition(catalog(reviewed), catalog(changedApproval)), /preserve the reviewed content/i);

  const changedEditor = release(approved);
  changedEditor.accountable_editor = 'Replacement editor';
  changedEditor.approved_sha256 = publicationRevisionHash(changedEditor);
  assert.throws(() => validateCatalogTransition(catalog(approved), catalog(changedEditor)), /cannot replace the approving editor/i);
});

test('correction transition embeds and hashes the immediate prior public revision', () => {
  const released = release(approve(review()));
  const corrected = structuredClone(released);
  corrected.revision = 2;
  corrected.editorial_state = 'corrected';
  corrected.correction_state = 'corrected';
  corrected.title = 'Corrected title';
  corrected.corrections = [{
    previous_revision: 1,
    previous_revision_sha256: publicationRevisionHash(released),
    previous_record: structuredClone(released),
    corrected_at: '2026-08-08T01:00:00Z',
    reason: 'Corrected wording',
    editor: 'Jeffrey',
    previous_text: 'Reviewed title',
    replacement_text: 'Corrected title',
  }];
  corrected.approved_sha256 = publicationRevisionHash(corrected);
  assert.doesNotThrow(() => validateCatalogTransition(catalog(released), catalog(corrected)));

  const fabricated = structuredClone(corrected);
  fabricated.corrections[0].previous_revision_sha256 = 'f'.repeat(64);
  fabricated.approved_sha256 = publicationRevisionHash(fabricated);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(fabricated)), /embed the hashed prior public revision/i);

  const replacedApproval = structuredClone(corrected);
  replacedApproval.approval_sha256 = 'c'.repeat(64);
  replacedApproval.approved_sha256 = publicationRevisionHash(replacedApproval);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(replacedApproval)), /retain the original approval hash/i);

  const rewrittenHistoricalApproval = structuredClone(corrected);
  rewrittenHistoricalApproval.corrections[0].previous_record.approved_sha256 = 'd'.repeat(64);
  rewrittenHistoricalApproval.approved_sha256 = publicationRevisionHash(rewrittenHistoricalApproval);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(rewrittenHistoricalApproval)), /embed the hashed prior public revision/i);

  const replacedClearance = structuredClone(corrected);
  replacedClearance.privacy_clearance = {...replacedClearance.privacy_clearance, reviewer: 'Replacement privacy reviewer'};
  replacedClearance.approved_sha256 = publicationRevisionHash(replacedClearance);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(replacedClearance)), /retain the approved privacy and rights clearance evidence/i);

  const injectedClearanceHash = structuredClone(corrected);
  injectedClearanceHash.privacy_clearance.approved_sha256 = 'e'.repeat(64);
  injectedClearanceHash.approved_sha256 = publicationRevisionHash(injectedClearanceHash);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(injectedClearanceHash)), /unsupported privacy clearance field/i);
});
