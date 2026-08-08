import test from 'node:test';
import assert from 'node:assert/strict';

import {publicationRevisionHash} from '../publication-contract.js';
import {validateCatalogTransition} from '../transition-contract.js';

const catalog = publication => ({schema_version: 1, publications: publication ? [publication] : []});
const review = () => ({
  id: 'dispatch-transition', revision: 1, editorial_state: 'review', title: 'Reviewed title',
  summary: 'Reviewed summary', content_type: 'Field Note', stream: 'Methods', generated_at: '2026-08-08T00:00:00Z',
  slug: 'transition', url: 'https://www.thevortexproject.org/dispatches/transition/',
  privacy_state: 'review', rights_state: 'review', evidence_state: 'reviewed source', correction_state: 'none',
  review_assessment: {
    state: 'checks-passed', checked_at: '2026-08-08T00:00:00Z', checked_by: ['Hermes Athena'],
    claims_basis: 'Primary-source comparison', privacy_basis: 'Public derivative scan', rights_basis: 'Source and usage review',
    sources: ['https://example.org/record'],
  },
  accountable_editor: null,
  sources: [{kind: 'primary', url: 'https://example.org/record', title: 'Primary record', retrieved_at: '2026-08-08'}],
});
const approve = source => {
  const record = structuredClone(source);
  record.editorial_state = 'approved';
  record.accountable_editor = 'Jeffrey';
  record.privacy_state = 'public-cleared';
  record.rights_state = 'public-cleared';
  record.publication_approval = {state: 'approved', editor: 'Jeffrey', decided_at: '2026-08-08T00:00:00Z', basis: 'Approved exact reviewed revision'};
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
  changedEditor.publication_approval.editor = 'Replacement editor';
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

  const replacedAssessment = structuredClone(corrected);
  replacedAssessment.review_assessment = {...replacedAssessment.review_assessment, claims_basis: 'Replacement assessment'};
  replacedAssessment.approved_sha256 = publicationRevisionHash(replacedAssessment);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(replacedAssessment)), /retain the review assessment and publication approval evidence/i);

  const injectedApprovalField = structuredClone(corrected);
  injectedApprovalField.publication_approval.approved_sha256 = 'e'.repeat(64);
  injectedApprovalField.approved_sha256 = publicationRevisionHash(injectedApprovalField);
  assert.throws(() => validateCatalogTransition(catalog(released), catalog(injectedApprovalField)), /unsupported publication approval field/i);
});
