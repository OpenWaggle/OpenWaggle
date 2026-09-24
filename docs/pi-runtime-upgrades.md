# Pi runtime upgrades

Pi publishes seven packages as one matched release. OpenWaggle keeps its direct Pi dependencies in the `pi-runtime` pnpm catalog and patches `pi-ai` plus `pi-coding-agent` for ADR 0025 compaction behavior.

## Update procedure

1. Check that all seven packages publish the same newest version:

   ```bash
   for package in pi-agent-core pi-ai pi-client pi-coding-agent pi-protocol pi-telemetry pi-tui; do
     pnpm view "@earendil-works/$package" version
   done
   ```

2. Review every Pi changelog section since the pinned release. Pay special attention to provider context, compaction, retry, queue, prompt, steering, and session-format changes.
3. Update all seven entries in `catalogs.pi-runtime` and all seven exact `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`. Keep temporary age exceptions only until the normal seven-day window passes.
4. Remove the two old `patchedDependencies` registrations, install the unpatched target release, and extract fresh patch workspaces:

   ```bash
   pnpm install --ignore-scripts
   pnpm patch @earendil-works/pi-ai@VERSION --ignore-existing --edit-dir /tmp/openwaggle-pi-ai
   pnpm patch @earendil-works/pi-coding-agent@VERSION --ignore-existing --edit-dir /tmp/openwaggle-pi-coding-agent
   ```

5. Port the changes into those fresh package trees. Do not rename an old patch. Reconcile the target release's code first, including Pi's canonical session context and compaction-budget behavior, then regenerate both patches:

   ```bash
   pnpm patch-commit /tmp/openwaggle-pi-ai
   pnpm patch-commit /tmp/openwaggle-pi-coding-agent
   ```

6. Delete the superseded patch files, run `pnpm install --ignore-scripts` to refresh `pnpm-lock.yaml`, and verify alignment:

   ```bash
   pnpm check:pi-runtime
   ```

7. Run the focused Pi compaction, reconstruction, retry, prompt, steering, scheduling, and settlement tests before the repository verification matrix. Re-audit the patched model capability lists against the target release instead of carrying model names forward without review.

`pnpm patch-commit` owns patch filenames and patch hashes. Review both generated diffs before accepting the lockfile update.
