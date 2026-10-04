import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
// Digests of the two locality names removed in October 2026. Keep the names
// out of this public guard and its diagnostics; these hashes are not secrets.
const forbidden = new Set([
  'd3b434276de6ca3e2833c90911640e842bbcd7e752950b9199c7091d0f53c08a',
  '2406d4e5c5f120d5f3e276866da2a1ff96a19113d9191ab1d6e1dee3e2e1b8fe',
]);

function localityOffsets(text, denied = forbidden) {
  const words = [...text.normalize('NFKC').toLowerCase().matchAll(/[a-z0-9]+/g)];
  return words.flatMap((word, index) => {
    // Joining adjacent words covers spaces, line wraps, hyphens and underscores.
    const candidates = [word[0], word[0] + (words[index + 1]?.[0] ?? '')];
    return candidates.some(value => denied.has(digest(value))) ? [word.index] : [];
  });
}

function coordinateOffsets(text) {
  const offsets = [];
  // High-precision decimal pairs, in either latitude/longitude order.
  const pairs = /(?<![\w.])([+-]?\d{1,3}\.\d{3,})\s*[,;]\s*([+-]?\d{1,3}\.\d{3,})(?![\w.])/g;
  for (const match of text.matchAll(pairs)) {
    const a = Math.abs(Number(match[1]));
    const b = Math.abs(Number(match[2]));
    if (a <= 180 && b <= 180 && Math.min(a, b) <= 90) offsets.push(match.index);
  }
  // Numeric JSON fields, assignments and URL parameters; variable references
  // and runtime coordinate handling remain valid.
  const labeled = /\b(?:[a-z0-9]+_)*(lat(?:itude)?|lon(?:gitude)?|lng)\b["']?\s*[:=]\s*["']?([+-]?\d{1,3}(?:\.\d+)?)(?![\w.])/gi;
  for (const match of text.matchAll(labeled)) {
    const limit = /^lat/i.test(match[1]) ? 90 : 180;
    if (Math.abs(Number(match[2])) <= limit) offsets.push(match.index);
  }
  // Decimal degrees or degrees/minutes/seconds with a compass direction.
  const degrees = /\b(\d{1,3}(?:\.\d+)?)\s*°\s*(?:\d{1,2}(?:\.\d+)?\s*['′]\s*)?(?:\d{1,2}(?:\.\d+)?\s*["″]\s*)?([NSEW])\b/gi;
  for (const match of text.matchAll(degrees)) {
    const limit = /[NS]/i.test(match[2]) ? 90 : 180;
    // An isolated whole-degree latitude may describe global imagery coverage.
    if (Number(match[1]) <= limit && (match[1].includes('.') || /['′]/.test(match[0]))) {
      offsets.push(match.index);
    }
  }
  const hemispheres = /\b\d{1,2}(?:\.\d+)?\s*°?\s*[NS]\s*[,;]?\s*\d{1,3}(?:\.\d+)?\s*°?\s*[EW]\b/gi;
  for (const match of text.matchAll(hemispheres)) offsets.push(match.index);
  return offsets;
}

test('locality guard handles case, line wraps and identifier separators', () => {
  const denied = new Set([digest('examplegrove'), digest('exampletown')]);
  for (const value of ['Example Grove', 'EXAMPLE\n  GROVE', 'example-grove-archive',
    'example_grove', 'ExampleGrove', 'EXAMPLETOWN']) {
    assert.ok(localityOffsets(value, denied).length);
  }
  assert.deepEqual(localityOffsets('Example groves; exampletownship; ordinary research', denied), []);
});

test('coordinate guard detects common literal forms without banning scientific numbers', () => {
  for (const value of ['12.3456, -123.4567', '[-123.4567,\n12.3456]',
    '"latitude": 12.3', 'station_lon = -123.4', '?lat=12&lon=-123',
    '12° 20′ 44″ N, 123° 27′ 24″ W', '12.3456°N', '12.3456 N, 123.4567 W', '12°N, 123°W']) {
    assert.ok(coordinateOffsets(value).length);
  }
  for (const value of ['Gemma 4 26B; Q4_K_M; BirdNET 6,522 species; 127 tok/s',
    'DOI: 10.1234/example.2026; arXiv: 2501.17841',
    '"confidence": 0.98765, "auc": 0.99876', '3.889e-07; 298.99; 1015.6',
    'latitude: place.latitude, longitude: place.longitude',
    '[298.1234, 357.5678]', 'rgba(12, 34, 56, 0.5)', '2026-10-04T00:39:04Z',
    'Coverage: 90°N–66°S; events south of 66°S remain in the ledger']) {
    assert.deepEqual(coordinateOffsets(value), []);
  }
});

test('tracked public text has no forbidden localities or obvious coordinate literals', async () => {
  // Read working-tree contents of tracked files, including dotfiles and newly
  // staged files. Git history, binary metadata and remote services are outside
  // this lightweight regression check; it is not a complete privacy audit.
  const paths = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
    .split('\0').filter(Boolean);
  const findings = [];
  for (const path of paths) {
    const label = localityOffsets(path).length ? '[redacted path]' : path;
    if (label !== path) findings.push('tracked path: forbidden locality');
    const bytes = await readFile(join(root, path));
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    const report = (offsets, kind) => {
      for (const offset of offsets) {
        const line = text.slice(0, offset).split('\n').length;
        findings.push(`${label}:${line}: ${kind}`);
      }
    };
    report(localityOffsets(text), 'forbidden locality');
    // Existing tests intentionally use synthetic/public geography fixtures.
    // Locality checks still cover tests; coordinate checks cover all other text,
    // including published data, source, documentation and discovery metadata.
    if (!path.startsWith('tests/')) report(coordinateOffsets(text), 'coordinate literal');
  }
  assert.equal(findings.length, 0, findings.join('\n'));
});
