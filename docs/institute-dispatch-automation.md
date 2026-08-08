# Institute Dispatch automation

## Operator model

The Dispatch controller automates candidate intake around one explicit human publication decision. Chat and scheduled jobs may research and enqueue candidates. They cannot approve, release, commit, push, or deploy.

Private queue:

`~/.hermes/vortex-institute/candidates/`

The queue is outside the public website repository. Its directory mode is `0700`; candidate records use `0600`.

## Chat triggers

Use these phrases with Hermes Athena:

- `Make an Institute Dispatch about TOPIC.`
- `Show the Institute Dispatch queue.`
- `Show Institute candidate CANDIDATE_ID.`
- `Reject Institute candidate CANDIDATE_ID because REASON.`
- `Move Institute candidate CANDIDATE_ID to review.`

`Make` performs source research, writes one schema-valid JSON input, and invokes the controller with `--origin=chat`. `Move ... to review` uses the shared-lock importer and creates a nonpublic `review` record. Approval and release remain separate commands.

## Scheduled trigger

The Hermes scheduler runs `institute-dispatch-candidate-queue` once daily. It gathers no more than one source-grounded candidate from authoritative public sources, invokes the same controller with `--origin=scheduled`, and reports the candidate ID. Duplicate source sets are rejected and do not create another queue record.

The scheduled job must not:

- inspect private Pine Hollow archives;
- publish local model output as an observation;
- import a candidate into the website repository;
- grant privacy or rights clearance;
- approve or release a record;
- commit or push Git;
- expose credentials, paths, hosts, coordinates, or private media.

## Candidate input schema

```json
{
  "schema_version": 1,
  "topic": "Short research topic",
  "title": "Publication title",
  "summary": "One bounded summary",
  "content_type": "Science Watch",
  "stream": "Science Watch",
  "related_program": "EarthNet / Cartographer",
  "evidence_level": "Authoritative external documentation",
  "evidence_state": "external context; no local observation claim",
  "slug": "lowercase-hyphenated-slug",
  "sections": [
    {"heading": "What changed", "body": "Source-grounded text."},
    {"heading": "Why it matters here", "body": "Bounded Vortex relevance."},
    {"heading": "What remains separate", "body": "Limitations and nonclaims."}
  ],
  "sources": [
    {
      "kind": "primary",
      "title": "Official source title",
      "url": "https://authoritative.example/item",
      "retrieved_at": "YYYY-MM-DD"
    }
  ],
  "ai_assistance": ["Hermes Athena"]
}
```

Allowed content types:

- `Field Note`
- `Vortex Update`
- `Research Brief`
- `Data Release`
- `Model Release`
- `Science Watch`
- `Open Build`
- `Correction`

Allowed streams:

- `From Pine Hollow`
- `Science Watch`
- `Open Builds`
- `Releases`
- `Methods`

## CLI

Invoke through the `terminal` tool from `/home/jvortex/vortex-site`.

Enqueue from chat:

```bash
node scripts/dispatch-candidate-controller.mjs enqueue \
  --input=/absolute/path/to/candidate.json \
  --origin=chat
```

Enqueue from scheduler:

```bash
node scripts/dispatch-candidate-controller.mjs enqueue \
  --input=/absolute/path/to/candidate.json \
  --origin=scheduled
```

List:

```bash
node scripts/dispatch-candidate-controller.mjs list
node scripts/dispatch-candidate-controller.mjs list --json
```

Show:

```bash
node scripts/dispatch-candidate-controller.mjs show --id=CANDIDATE_ID
```

Reject:

```bash
node scripts/dispatch-candidate-controller.mjs reject \
  --id=CANDIDATE_ID \
  --reason='Recorded reason'
```

Import into nonpublic review:

```bash
scripts/import-dispatch-candidate.sh --id=CANDIDATE_ID
```

The queue controller exposes no import command. The shell wrapper invokes the separate `scripts/import-dispatch-candidate.mjs` coordinator. The coordinator acquires `$HOME/.cache/vortex-site/git.lock` itself through `flock`; its worker verifies that `flock` is its direct parent and that the parent command names the configured lock and importer. Git index and tracked-tree checks run inside that lock before either durable record changes.

## Validation and deduplication

Enqueue rejects:

- unknown top-level, section, or source fields;
- unsupported content types or streams;
- malformed slugs;
- missing sections;
- missing HTTPS primary sources;
- invalid retrieval dates;
- private-boundary keys;
- private paths and common credential assignments;
- source URL userinfo credentials and secret-bearing query parameter names;
- loopback, RFC1918, link-local, multicast/reserved, private IPv6, and private DNS source hosts.

Fingerprint version 1 hashes sorted canonical primary-source URLs after removing fragments and allowlisted tracking parameters and sorting meaningful query parameters. Rewording a title or slug cannot enqueue the same source set twice. Enqueue also rejects any primary-source URL already present in another queued candidate or in the Institute catalog.

The queue root must remain both lexically and physically outside the public website checkout; real-path containment catches symlinked ancestors, and the queue root itself cannot be a symlink. Queue writes use a private queue lock with an owner record, PID-specific temporary files, atomic rename, and explicit file permissions. Queue locks are never reclaimed automatically; an abandoned lock fails closed until an operator inspects `owner.json` and removes it deliberately.

## Review import boundary

Import creates exactly one catalog record with:

- `editorial_state: review`;
- `privacy_state: review`;
- `rights_state: review`;
- `accountable_editor: null`;
- no approval hash;
- no release timestamp.

The candidate becomes `imported` and records the resulting publication ID. The importer rejects duplicate IDs or slugs. It cannot approve or release.

Before import, the mutator revalidates the proposal, recomputes its versioned source fingerprint and full content hash, verifies the candidate ID, repeats queue and catalog source-deduplication checks, and rejects any post-enqueue mutation.

Import uses a recoverable `queued → importing → imported` journal. If execution stops after the catalog write, the next locked invocation compares the existing review record with the expected publication hash and completes the queue transition without creating a duplicate. A dirty working tree is accepted only for that exact interrupted-import recovery path.

## Next publication steps

After import:

1. inspect the public-safe review record;
2. run claim/source, privacy, and rights review;
3. record distinct clearance decisions;
4. compute the exact record hash;
5. promote `review → approved`;
6. commit that transition;
7. separately promote `approved → released`;
8. commit, deploy, and verify production.

See `docs/institute-publication.md` for those gates.
