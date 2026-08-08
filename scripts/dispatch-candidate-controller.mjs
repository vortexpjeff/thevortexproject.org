#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {homedir} from 'node:os';
import {basename, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';


const PRIVATE_KEYS = new Set([
  'private_path', 'private_host', 'hostname', 'token', 'password', 'credentials',
  'latitude', 'longitude', 'lat', 'lon', 'coordinates', 'raw_audio', 'raw_media',
]);
const CANDIDATE_FIELDS = new Set([
  'schema_version', 'topic', 'title', 'summary', 'content_type', 'stream',
  'related_program', 'evidence_level', 'evidence_state', 'slug', 'sections',
  'sources', 'ai_assistance',
]);
const CONTENT_TYPES = new Set([
  'Field Note', 'Vortex Update', 'Research Brief', 'Data Release', 'Model Release',
  'Science Watch', 'Open Build', 'Correction',
]);
const STREAMS = new Set(['From Pine Hollow', 'Science Watch', 'Open Builds', 'Releases', 'Methods']);
const SOURCE_KINDS = new Set(['primary', 'secondary']);
const ORIGINS = new Set(['chat', 'scheduled']);
const PRIVATE_TEXT = [
  /\/home\/[^\s/]+\//i,
  /\/mnt\/[a-z]\//i,
  /(?:^|\D)192\.168\.\d{1,3}\.\d{1,3}(?:\D|$)/,
  /(?:^|\D)10\.\d{1,3}\.\d{1,3}\.\d{1,3}(?:\D|$)/,
  /(?:password|credentials?|api[_ -]?key|access[_ -]?token)\s*[:=]/i,
];

const args = parseArgs(process.argv.slice(3));
const command = process.argv[2];
export const queueDir = resolve(process.env.VORTEX_INSTITUTE_QUEUE || join(homedir(), '.hermes', 'vortex-institute', 'candidates'));
const defaultRepo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const siteRepo = resolve(process.env.VORTEX_SITE_REPO || defaultRepo);
const queueRelativeToRepo = relative(siteRepo, queueDir);
if (queueRelativeToRepo === '' || (!queueRelativeToRepo.startsWith('..') && !isAbsolute(queueRelativeToRepo))) {
  throw new Error('candidate queue must remain outside the website repository');
}

function parseArgs(values) {
  return Object.fromEntries(values.map(value => {
    if (!value.startsWith('--')) throw new Error(`unsupported argument: ${value}`);
    const [key, ...rest] = value.slice(2).split('=');
    return [key, rest.length ? rest.join('=') : true];
  }));
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`candidate requires ${label}`);
  return value.trim();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex');
}

export function now() {
  const value = process.env.VORTEX_NOW || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('VORTEX_NOW must be a UTC RFC3339 timestamp');
  }
  return value;
}

function calendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function requirePublicSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('candidate source requires a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('candidate requires an HTTPS primary source');
  if (url.username || url.password) throw new Error('candidate source URL cannot contain credentials');
  const secretParameter = [...url.searchParams.keys()].find(key => /(?:^|[_-])(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|auth(?:orization)?|credential|signature|client[_-]?secret|code)(?:$|[_-])/i.test(key));
  if (secretParameter) throw new Error(`candidate source URL cannot contain secret-bearing query parameter: ${secretParameter}`);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || ['.localhost', '.local', '.lan', '.home', '.internal'].some(suffix => hostname.endsWith(suffix))) {
    throw new Error('candidate source URL must use a public host');
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const octets = hostname.split('.').map(Number);
    const privateIpv4 = octets[0] === 0 || octets[0] === 10 || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || octets[0] >= 224;
    if (privateIpv4) throw new Error('candidate source URL must use a public host');
  } else if (ipVersion === 6) {
    if (hostname === '::1' || hostname === '::' || /^f[cd]/i.test(hostname) || /^fe[89ab]/i.test(hostname)) {
      throw new Error('candidate source URL must use a public host');
    }
  }
  return url;
}

function checkPrivateKeys(value, trail = 'candidate') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) throw new Error(`private boundary key is not allowed: ${trail}.${key}`);
    checkPrivateKeys(child, `${trail}.${key}`);
  }
}

function checkPrivateText(value) {
  const text = JSON.stringify(value);
  if (PRIVATE_TEXT.some(pattern => pattern.test(text))) throw new Error('candidate crosses a private boundary');
}

export function validateInput(input) {
  if (!input || input.schema_version !== 1) throw new Error('candidate input requires schema_version 1');
  const unknown = Object.keys(input).find(key => !CANDIDATE_FIELDS.has(key));
  if (unknown) throw new Error(`unsupported candidate field: ${unknown}`);
  checkPrivateKeys(input);
  checkPrivateText(input);
  for (const key of ['topic', 'title', 'summary', 'content_type', 'stream', 'related_program', 'evidence_level', 'evidence_state', 'slug']) {
    requireText(input[key], key);
  }
  if (!CONTENT_TYPES.has(input.content_type)) throw new Error(`unsupported content_type: ${input.content_type}`);
  if (!STREAMS.has(input.stream)) throw new Error(`unsupported stream: ${input.stream}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) throw new Error('candidate slug must be lowercase hyphenated text');
  if (!Array.isArray(input.sections) || input.sections.length === 0) throw new Error('candidate requires sections');
  for (const section of input.sections) {
    const unknownSection = Object.keys(section || {}).find(key => !['heading', 'body'].includes(key));
    if (unknownSection) throw new Error(`unsupported section field: ${unknownSection}`);
    requireText(section?.heading, 'section heading');
    requireText(section?.body, 'section body');
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new Error('candidate requires sources');
  let primary = false;
  for (const source of input.sources) {
    const unknownSource = Object.keys(source || {}).find(key => !['kind', 'title', 'url', 'retrieved_at'].includes(key));
    if (unknownSource) throw new Error(`unsupported source field: ${unknownSource}`);
    requireText(source?.kind, 'source kind');
    if (!SOURCE_KINDS.has(source.kind)) throw new Error(`unsupported source kind: ${source.kind}`);
    requireText(source?.title, 'source title');
    requirePublicSourceUrl(source.url);
    if (!calendarDate(source.retrieved_at)) throw new Error('candidate source requires a real retrieved_at date');
    if (source.kind === 'primary') primary = true;
  }
  if (!primary) throw new Error('candidate requires an HTTPS primary source');
  if (!Array.isArray(input.ai_assistance) || input.ai_assistance.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('candidate ai_assistance must be a string array');
  }
  return input;
}

export function candidateFingerprint(input, version = 1) {
  if (version === 0) return sha256({sources: primarySourceUrls(input)});
  if (version === 1) return sha256({fingerprint_version: 1, sources: primarySourceUrls(input)});
  throw new Error(`unsupported candidate fingerprint version: ${version}`);
}

export function candidateContentHash(input) {
  return sha256({candidate_schema_version: 1, candidate: input});
}

function canonicalSourceUrl(value) {
  const url = new URL(value);
  url.hash = '';
  const parameters = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith('utm_') && !['gclid', 'fbclid'].includes(key.toLowerCase()))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = '';
  for (const [key, valuePart] of parameters) url.searchParams.append(key, valuePart);
  return url.href;
}

function primarySourceUrls(value) {
  return (value.sources || [])
    .filter(source => source.kind === 'primary')
    .map(source => canonicalSourceUrl(source.url))
    .sort();
}

export function sharesPrimarySource(left, right) {
  const rightUrls = new Set(primarySourceUrls(right));
  return primarySourceUrls(left).some(url => rightUrls.has(url));
}

async function ensureQueue() {
  try {
    const existing = await lstat(queueDir);
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('candidate queue root must be a real directory');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(queueDir, {recursive: true, mode: 0o700});
  const realQueueDir = await realpath(queueDir);
  const realSiteRepo = await realpath(siteRepo);
  const realQueueRelativeToRepo = relative(realSiteRepo, realQueueDir);
  if (realQueueRelativeToRepo === '' || (!realQueueRelativeToRepo.startsWith('..') && !isAbsolute(realQueueRelativeToRepo))) {
    throw new Error('candidate queue must remain physically outside the website repository');
  }
  await chmod(queueDir, 0o700);
}

export async function withQueueLock(operation) {
  await ensureQueue();
  const lockPath = join(queueDir, '.controller-lock');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await mkdir(lockPath, {mode: 0o700});
      try {
        await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify({pid: process.pid, created_at: new Date().toISOString()})}\n`, {mode: 0o600});
        return await operation();
      } finally {
        await rm(lockPath, {recursive: true, force: true});
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
  }
  throw new Error('candidate queue is busy');
}

export async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function candidateFiles() {
  await ensureQueue();
  return (await readdir(queueDir, {withFileTypes: true}))
    .filter(entry => entry.isFile() && /^candidate-.+\.json$/.test(entry.name))
    .map(entry => join(queueDir, entry.name))
    .sort();
}

export async function loadAll() {
  return Promise.all((await candidateFiles()).map(async path => JSON.parse(await readFile(path, 'utf8'))));
}

function requireId() {
  const id = requireText(args.id, '--id');
  if (!/^candidate-[a-z0-9-]+$/.test(id) || basename(id) !== id) throw new Error('invalid candidate id');
  return id;
}

export async function loadById(id) {
  try {
    const path = join(queueDir, `${id}.json`);
    const candidateStat = await lstat(path);
    if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) throw new Error(`candidate record is not a regular file: ${id}`);
    return JSON.parse(await readFile(path, 'utf8'));
  }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`candidate not found: ${id}`);
    throw error;
  }
}

async function enqueue() {
  const origin = requireText(args.origin, '--origin');
  if (!ORIGINS.has(origin)) throw new Error('--origin must be chat or scheduled');
  const inputPath = resolve(requireText(args.input, '--input'));
  const input = validateInput(JSON.parse(await readFile(inputPath, 'utf8')));
  return withQueueLock(async () => {
    const digest = candidateFingerprint(input);
    const duplicate = (await loadAll()).find(item => item.fingerprint_sha256 === digest || sharesPrimarySource(item, input));
    if (duplicate) throw new Error(`duplicate candidate fingerprint already queued as ${duplicate.id}`);
    const catalogPath = join(siteRepo, 'institute-src', '_data', 'editorial.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    const represented = catalog.publications.find(record => sharesPrimarySource(record, input));
    if (represented) throw new Error(`primary source is already represented in the Institute catalog by ${represented.id}`);
    const createdAt = now();
    const id = `candidate-${createdAt.slice(0, 10).replaceAll('-', '')}-${input.slug}-${digest.slice(0, 10)}`;
    const record = {
      schema_version: 1,
      id,
      status: 'queued',
      origin,
      created_at: createdAt,
      fingerprint_sha256: digest,
      fingerprint_version: 1,
      content_sha256: candidateContentHash(input),
      ...input,
      review_checks: {
        claims: {state: 'pending'},
        privacy: {state: 'pending'},
        rights: {state: 'pending'},
      },
      decision: null,
    };
    await atomicJson(join(queueDir, `${id}.json`), record);
    return record;
  });
}

async function listCandidates() {
  const records = (await loadAll()).sort((left, right) => right.created_at.localeCompare(left.created_at));
  if (args.json) return records;
  return records.length
    ? records.map(item => `${item.id}\t${item.status}\t${item.origin}\t${item.title}`).join('\n')
    : 'Candidate queue is empty';
}

async function reject() {
  const id = requireId();
  const reason = requireText(args.reason, '--reason');
  return withQueueLock(async () => {
    const record = await loadById(id);
    if (record.status !== 'queued') throw new Error(`${id} is ${record.status}, not queued`);
    record.status = 'rejected';
    record.decision = {state: 'rejected', decided_at: now(), reason};
    await atomicJson(join(queueDir, `${id}.json`), record);
    return record;
  });
}

async function main() {
  let output;
  if (command === 'enqueue') output = await enqueue();
  else if (command === 'list') output = await listCandidates();
  else if (command === 'show') output = await loadById(requireId());
  else if (command === 'reject') output = await reject();
  else throw new Error('usage: dispatch-candidate-controller.mjs enqueue|list|show|reject [--key=value]');
  console.log(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
