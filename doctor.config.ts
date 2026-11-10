/**
 * React Doctor configuration.
 *
 * Policy: no blanket rule disables, and no suppression of a finding that could be
 * fixed in code. Every override below is a verified false positive, scoped to the
 * single file + single rule it applies to, with the reason it cannot be fixed.
 *
 * Types are declared inline rather than imported from 'react-doctor' so this file
 * stays a plain data module. The tool is a pinned devDependency (see package.json),
 * run as the required `--blocking warning` gate, so any new finding fails it.
 */
interface DoctorConfig {
  readonly ignore?: {
    readonly files?: readonly string[]
    readonly rules?: readonly string[]
    readonly overrides?: readonly {
      readonly files: readonly string[]
      readonly rules?: readonly string[]
    }[]
  }
}

const config: DoctorConfig = {
  ignore: {
    /*
     * Generated trees and per-session worktrees. Scanning them reports findings for
     * build output and for copies of the repository, neither of which is source.
     */
    files: [
      '.codex/worktrees/**',
      '.openwaggle/worktrees/**',
      '.pi/worktrees/**',
      '.typecheck/**',
      'dist/**',
      'out/**',
      'website/dist/**',
    ],
    rules: [],
    overrides: [
      {
        // The effect clears its recursive timeout and marks in-flight replies disposed.
        // action-run-reconnect.component.test verifies both queued and in-flight teardown.
        // The analyzer misses the timer assignment inside the async poll callback.
        files: ['src/renderer/src/features/project-actions/hooks/useActionOutput.ts'],
        rules: ['react-doctor/effect-needs-cleanup'],
      },
      {
        // closeMenuThen calls its callback once from a menu event after closing
        // the menu. It never passes that callback to a React state setter.
        files: ['src/renderer/src/features/project-actions/components/ProjectActionsControl.tsx'],
        rules: ['react-doctor/no-impure-state-updater'],
      },
      {
        // run invokes an async operation once from a user event and tracks its
        // promise. Its callback is not a React functional state updater.
        files: ['src/renderer/src/features/settings/hooks/useBrowserProfilesSettings.ts'],
        rules: ['react-doctor/no-impure-state-updater'],
      },
      {
        // Package-smoke fixtures are entry points for the `package:smoke`
        // typecheck (see tests/fixtures/package-smoke/tsconfig.json), which
        // verifies published type declarations resolve under CJS and ESM.
        // They are compiled via tsconfig `files`, never imported, so the
        // import-graph reachability check reports them as unused.
        files: ['tests/fixtures/package-smoke/**'],
        rules: ['deslop/unused-file'],
      },
      {
        /*
         * The oxlint CLI auto-discovers this config; nothing imports it, so the
         * import-graph reachability check cannot see it is load-bearing.
         *
         * Verified rather than assumed: `oxlint --print-config` returns the same
         * effective config with and without an explicit
         * `--config oxlint.config.mts` (categories.correctness "allow", 29 rules,
         * ignorePatterns applied). Deleting the file would silently re-enable the
         * correctness category for the whole repository.
         */
        files: ['oxlint.config.mts'],
        rules: ['deslop/unused-file'],
      },
      {
        /*
         * `@effect/workflow` and `@effect/cluster` are declared to satisfy peer
         * requirements, not to be imported: `@effect/platform-node` (used) pulls in
         * `@effect/platform-node-shared`, which peers `@effect/cluster ^0.60.1`,
         * which in turn peers `@effect/workflow ^0.19.0`. Satisfying a peer is not
         * an import, so import-graph analysis reports them as unused.
         *
         * Verified by removing both and reinstalling (with pnpm, before Bun): it pulled newer
         * transitive copies (cluster 0.60.2 / workflow 0.19.1) which demanded newer
         * @effect/platform, rpc, sql and effect, turning one pre-existing unmet peer
         * into four. Removal makes the tree worse, so this cannot be fixed in code.
         *
         * Note this override is necessarily rule-wide: package.json is the only file
         * `unused-dev-dependency` can fire on. If the @effect ecosystem versions are
         * ever realigned, re-test by removing both and reading `bun install`'s
         * peer-dependency warnings.
         */
        files: ['package.json'],
        rules: ['deslop/unused-dev-dependency'],
      },
      {
        // `String.prototype.includes`, not `Array.prototype.includes`: these do
        // substring matching (a free-text tree-filter query, error-message fragment
        // matching, and a search needle inside a transcript node's folded text). A Set
        // gives O(1) equality lookups and cannot perform substring matching, so the
        // suggested fix does not apply.
        files: [
          'src/renderer/src/features/session-tree/lib/session-tree-filter.ts',
          'src/main/store/sessions/session-node-search.ts',
          'src/shared/domain/error-classifier.ts',
        ],
        rules: ['react-doctor/js-set-map-lookups'],
      },
      {
        // `sql.unsafe()` here executes schema migrations from APP_MIGRATIONS - a
        // module-level `readonly AppMigration[]` of literal DDL strings. No user
        // or runtime input reaches it, and DDL cannot be parameterized, so a
        // prepared statement is not an option.
        files: ['src/main/services/database-service.ts'],
        rules: ['react-doctor/raw-sql-injection-risk'],
      },
      {
        // The credential-shaped literals here are synthetic test INPUT for the
        // assertions that the bootstrap preflight redacts secrets from command
        // output (`expect(message).not.toContain(githubSecret)`). Removing them
        // would delete the regression test that proves redaction works.
        files: ['scripts/__tests__/package-release-bootstrap-preflight.unit.test.ts'],
        rules: ['react-doctor/no-secrets-in-client-code'],
      },
      {
        // These awaits are sequential interactive prompts (label -> role prompt ->
        // model -> colour) in the Waggle agent editor. The ordering IS the UX:
        // running them concurrently would render several prompts at once.
        files: ['packages/pi-waggle/src/default-agent-editor.ts'],
        rules: ['react-doctor/server-sequential-independent-await'],
      },
      {
        // The iframe has a literal `sandbox="allow-scripts allow-same-origin"`
        // attribute. The rule misses it because `src` is assigned in a layout
        // effect after the watchdog is armed instead of being a JSX prop.
        files: ['src/renderer/src/features/chat/components/InlineVisualization.tsx'],
        rules: ['react-doctor/iframe-missing-sandbox'],
      },
      {
        // `allow-scripts allow-same-origin` is safe here only because the frame's document comes
        // from its own `openwaggle-mcp-app://frame-<uuid>` origin, never OpenWaggle's, so being
        // same-origin gives it nothing of the page (ADR 0053). Apps need it for cookies and
        // IndexedDB, as inline visualizations do above.
        files: ['src/renderer/src/features/mcp/McpAppHost.tsx'],
        rules: ['react-doctor/iframe-missing-sandbox'],
      },
      {
        // These round-trips are deliberate JSON serialization, not deep clones. The
        // serialization test compares the wire frame with what JSON.stringify produces,
        // and its payload has a counting `toJSON()` method that structuredClone would
        // ignore (and, being a function, would throw on). The payload helper captures
        // the provider request as the SDKs send it on the wire, which drops `undefined`
        // values and calls `toJSON()`; structuredClone keeps the first and skips the second.
        files: [
          'src/main/application/__tests__/session-host-event-serialization.unit.test.ts',
          'src/main/adapters/pi/__tests__/provider-tool-payload.test-utils.ts',
        ],
        rules: ['react-doctor/no-json-parse-stringify-clone'],
      },
      {
        // Every read here draws on one shared byte budget (`remainingBytes`), checked and
        // then decremented per file, so read order decides which file crosses the limit.
        // Reading the kinds or the files of a kind concurrently would make the outcome
        // depend on I/O timing. The catalog is bounded and read rarely.
        files: [
          'src/main/adapters/syntax-resource-persistence.ts',
          'src/main/adapters/syntax-resource-persistence-read.ts',
        ],
        rules: [
          'react-doctor/async-parallel',
          'react-doctor/server-sequential-independent-await',
          'react-doctor/async-await-in-loop',
        ],
      },
      {
        // The handoff snapshot is a chain of git processes on one repository: resolve HEAD,
        // write the index tree, snapshot the worktree through a scratch index, then create
        // the commits. Each commit-tree names trees and parents from the steps before it,
        // and the snapshot records HEAD, index and worktree in that order on purpose.
        files: ['src/main/adapters/git/workspace-handoff-snapshot.ts'],
        rules: ['react-doctor/server-sequential-independent-await'],
      },
      {
        // recoverCursor can repair the history log after an interrupted write, and the read
        // that follows must see the repaired file, so the two cannot overlap.
        files: ['src/main/adapters/terminal/terminal-history-store.ts'],
        rules: ['react-doctor/server-sequential-independent-await'],
      },
      {
        // The awaited capture is not skipped by the early return: `capture?.invocation` is
        // the command the preparation launches, so it must exist before `launches.start`.
        // The later `!capture` return only decides whether to read back what it captured.
        files: ['src/main/adapters/project-actions/preparation-process.ts'],
        rules: ['react-doctor/async-defer-await'],
      },
      {
        // The Function body is the constant `return import(specifier)`; no input becomes
        // code, only the specifier argument, which `import()` treats as a module name. It is
        // the one way pi-waggle's CommonJS build gets a real `import()` for ESM-only pi-ai:
        // TypeScript compiles a literal `import()` there to `require()`, which cannot load it.
        files: ['packages/pi-waggle/src/esm-import.ts'],
        rules: ['react-doctor/no-eval'],
      },
      {
        // The flagged step runs the NSIS installer that the same job just built from this
        // checkout with electron-builder (`dist/openwaggle-<version>-x64.exe`), to smoke it.
        // Nothing is downloaded or fetched from another repository, so no trust boundary is
        // crossed.
        files: ['.github/workflows/nightly.yml'],
        rules: ['react-doctor/plugin-update-trust-risk'],
      },
    ],
  },
}

export default config
