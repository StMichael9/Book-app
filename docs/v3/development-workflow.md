# V3 development and integration workflow

Michael requested a shared V3 branch with separate feature branches and pull requests.

- `main` remains the released V2 baseline. Do not change the default branch or deploy V3 without explicit approval. Existing V2 branches remain intact.
- `v3` is the integration branch, initially created at the verified released main commit `100ab702faf8baa17289f93caa36c1bd41c4c34a`. Do not commit implementation directly to it.
- Existing `codex/v3-reading-home` is the M0/M1 feature branch. Publish it and open a PR whose base is `v3`, preserving its local implementation and correction commits.
- Subsequent milestones use separate branches such as `codex/v3-m2-reading-lifecycle`, starting from the accepted `v3` tip. Each PR targets `v3`, not `main` or a V2 branch.
- PR descriptions include scope, actual executed tests, migration/data compatibility, QA findings and unresolved limits. A chat QA report is evidence, not a fabricated GitHub review or CI pass.
- Merge only after the milestone's verification and independent QA decision support it; use a merge commit to retain the reviewed feature commits. Do not force-push, rewrite, or delete existing branches. Repository protection/check requirements take precedence; never bypass them.
- If repository rules are not configured, this remains a documented procedural gate, not a claim that GitHub enforces branch protection.
- Do not run production catalogue workflows, migrations or deployments from V3 development. Testing uses fresh synthetic local databases. Changes to hosted settings, production migrations and public enablement still need separate approval.

M1 client findings V3-M1-001 and V3-M1-002 are independently closed. Broader independent M1 verification is approved on isolated local targets and must finish before promoting M1 and beginning M2. Michael has conditionally authorized M2 after M1 is a go; M3 and later phases remain outside that authorization.
