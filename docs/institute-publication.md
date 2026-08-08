# Institute publication and deployment

## Boundaries

The public repository is a rendering and release surface. Fleet agents and private Pine Hollow systems do not write into it. Candidate, draft, review, and approved records remain absent from public RSS, JSON Feed, sitemap article entries, and `/api/publications.json`. Only `released`, `corrected`, `superseded`, and `retracted` records are public.

## Builds

- `npm run build:preview` renders review fixtures with `noindex,nofollow` and writes `_site/build-manifest.json`.
- `npm run build:production` excludes preview-only pages, renders only public records, uses `index,follow`, and writes a SHA-256 manifest.
- `npm test` runs the preview contract and repository unit suite.
- `npm run test:production` builds and verifies the production contract.

Both modes validate `institute-src/_data/editorial.json` before rendering. Production additionally compares the candidate catalog with the prior Git revision. A public record requires a named editor, HTTPS primary source, public privacy and rights clearance, and an exact `approved_sha256` calculated from canonical record content.

## Exact-revision promotion

Candidate generation is automated separately from publication. Chat and scheduled triggers enqueue private records under `~/.hermes/vortex-institute/candidates/` through `scripts/dispatch-candidate-controller.mjs`; they cannot approve, release, commit, push, or deploy. Use `scripts/import-dispatch-candidate.sh --id=CANDIDATE_ID` only after an explicit instruction to move a candidate into nonpublic review. See `docs/institute-dispatch-automation.md` for the queue schema and trigger commands.

Compute the current review-record hash with `publicationRevisionHash` or a bounded inspection script, then run:

```bash
scripts/promote-publication.sh \
  --id=PUBLICATION_ID \
  --to=approved \
  --editor=Jeffrey \
  --expected-sha256=CURRENT_REVIEW_HASH
```

Repeat with `--to=released` only after reviewing the approved record and production render. The expected hash prevents promoting a revision that changed after review. Release preserves the approving editor and stores the prior approved revision hash as `approval_sha256`. Promotion writes atomically and revalidates the complete catalog.

Privacy and rights clearance must already be present in the exact record before promotion; the command never grants either clearance. Each clearance is a hashed decision object with a reviewer identity, UTC decision timestamp, and basis. Privacy and rights use separate reviewers, both distinct from the accountable editor. Released promotion also requires a real UTC RFC3339 `--published-at` value.

The Node mutator refuses direct execution. `scripts/promote-publication.sh` acquires the same `flock` used by Observatory and uses a PID-specific temporary file before atomic rename, preventing concurrent promotion overwrite.

Corrections are new revisions. Every public correction state must preserve the original approval hash and the exact approved privacy and rights clearance evidence, plus a contiguous history containing each prior public record in full, its verified SHA-256, previous wording, replacement wording, reason, editor, and timestamp. The newest history entry must hash the immediately preceding Git revision. Do not silently rewrite released history.

`scripts/validate-publication-transition.mjs` enforces repository history. New records may enter only as fixture, draft, or review; approval must preserve reviewed content; release must preserve approved content and editor; and correction states must increment the revision exactly once. The Pages workflow validates against the triggering commit's previous SHA, so directly editing a record into a released state fails the deployment.

Gated records cannot be deleted. Corrections retain the original approval hash and the byte-equivalent prior correction-history prefix, including every embedded historical approval hash. Pull-request CI runs the same production transition contract against the base branch before merge.

## Repository coordination

Observatory and editorial publication share `$HOME/.cache/vortex-site/git.lock` through `flock`. Both refuse to operate when the Git index already contains staged paths. This prevents the 30-minute Observatory process from committing an editorial release under an Observatory commit message.

The Observatory transaction also requires a clean tracked working tree, fast-forwards from `origin/main`, generates the payload, stages only `data/observatory.json`, verifies that exact allowlist, commits, and pushes while still holding the lock. Git or network failures exit nonzero.

- Active locked Observatory entry point: `scripts/publish-observatory.sh`
- Active Hermes wrapper: `~/.hermes/scripts/observatory_push.sh`
- Editorial validation/staging: `scripts/prepare-editorial-release.sh`

The Hermes wrapper executes `/home/jvortex/vortex-site/scripts/publish-observatory.sh`. After changing either path, run one bounded Observatory cycle and verify its single-path commit or clean unchanged-payload exit.

The editorial script stages only the structured catalog and Institute source directories. Commit and push remain deliberate operations.

## GitHub Pages

`.github/workflows/deploy-pages.yml` builds an immutable production artifact from the triggering commit, uploads `_site`, and deploys it with the official Pages actions. Workflow concurrency uses one `vortex-pages` group and cancels obsolete in-progress deployments.

Before the first push containing the deployment workflow, switch repository Pages source from branch/root to **GitHub Actions**. Do not push the workflow while branch/root remains the intended active deployment mechanism unless a failed deployment run is acceptable.

## Cutover gate

1. Confirm clean expected working tree and synchronized `origin/main`.
2. Run `npm ci`, `npm test`, and `npm run test:production`.
3. Build production twice from unchanged source and compare manifests.
4. Serve `_site` from a confirmed free port and assert the Vortex title before browser tests.
5. Run desktop and 390 px mobile matrices for all five surfaces.
6. Scan `_site` for private paths, coordinates, hosts, credentials, raw-media references, and unreleased states.
7. Obtain independent blocker/high review approval.
8. Commit exact files; switch Pages source to GitHub Actions; push.
9. Verify the workflow artifact, deployment revision, canonical `www` URLs, feeds, catalog, sitemap, and `data/observatory.json`.
10. Confirm the next Observatory tick commits only its payload and triggers a clean production rebuild.

## Rollback

The rollback unit is the last known-good Git commit and its Pages artifact. Revert the release commit or redeploy the prior commit through `workflow_dispatch`. Do not repair production by editing generated `_site` files or GitHub Pages output directly.

The canonical public origin is `https://www.thevortexproject.org`. The apex is not a valid verification target until its TLS certificate covers `thevortexproject.org`.
