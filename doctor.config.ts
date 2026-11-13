/**
 * React Doctor configuration.
 *
 * Policy: no blanket rule disables, and no suppression of a finding that could be
 * fixed in code. Every override below is a verified false positive, scoped to the
 * files and rules it applies to, with the reason it cannot be fixed. Several files
 * share one override only when its reason holds for each of them. For
 * `async-await-in-loop` the false positive is work that must stay sequential:
 * ordered writes, transactions with rollback, locks, waits and polls, or loops kept
 * one at a time to bound resources.
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
        // Session batches load one after another: the Session Host reads them on one SQLite
        // connection, so batches sent together only queue there, and a cancelled caller must
        // be able to stop before the next batch is requested.
        files: ['src/shared/utils/batches.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // The workspace environment is read only after the action's invocation resolved:
        // reading it can finish a pending worktree's setup, which a launch that fails on its
        // invocation must not do. action-launch-preflight.unit.test checks the order.
        files: ['src/main/adapters/project-actions/action-launch-preflight.ts'],
        rules: ['react-doctor/server-sequential-independent-await'],
      },
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
        // Reading the kinds concurrently would make the outcome depend on I/O timing.
        files: ['src/main/adapters/syntax-resource-persistence.ts'],
        rules: ['react-doctor/async-parallel', 'react-doctor/server-sequential-independent-await'],
      },
      {
        // Each file read draws on one shared budget, checked and then decremented per
        // file: bytes in the installed library, entries in a project's resource inputs.
        // Read order decides which file crosses the limit, so the reads stay in order.
        files: [
          'src/main/adapters/syntax-resource-persistence-read.ts',
          'src/main/adapters/syntax-resource-project-catalog.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // The Electron-to-Electrobun migrator, one item at a time on purpose: DPAPI unwraps
        // and keychain re-seals each touch the OS keychain, which can prompt, so a refusal
        // stops before the next item asks again; LevelDB tables and logs are replayed in file
        // order, because a later record overrides an earlier one.
        files: [
          'src/main/electron-migration/electron-safe-storage.ts',
          'src/main/electron-migration/leveldb.ts',
          'src/main/electron-migration/secret-files.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // The Electrobun CEF probe types into the preview over CDP one key at a time: each
        // keyDown/keyUp pair must reach the page in order, or the typed value is scrambled.
        files: ['vendor/electrobun/probe/src/bun/index.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Each vault secret is decrypted through the OS keychain (Electron safeStorage).
        // The loop returns at the first secret that cannot be read, so a locked or refused
        // keychain is not asked again for the same server's other secrets.
        files: [
          'src/main/adapters/mcp/config/mcp-deferred-secrets.ts',
          'src/main/adapters/mcp/config/mcp-runtime-secret-resolution.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // MCP migrations that write, one location or sign-in at a time: each migrates under
        // the migration's process file lock and records its outcome before the next starts.
        // mcp-write-refusal and openwaggle-mcp-migration also stop, or switch to gating the
        // rest, at the first location whose lock another process holds.
        files: [
          'src/main/adapters/mcp/config/mcp-write-refusal.ts',
          'src/main/adapters/mcp/migration/migrate-openwaggle-mcp-files.ts',
          'src/main/adapters/mcp/migration/oauth-state-migration.ts',
          'src/main/adapters/mcp/migration/session-switch-migration.ts',
          'src/main/adapters/pi/mcp/openwaggle-mcp-migration.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Ordered writes and transactions with rollback. Each step depends on the one
        // before it: action-publication-files creates `.openwaggle`, then the recovery
        // directory inside it; the terminal history moves and the owner migration apply one
        // move at a time and roll back exactly the applied ones, in reverse; the history
        // flush appends a terminal's batches in order and holds back the rest of a terminal
        // whose append failed; path cleanup reports each entry just before removing it and
        // stops at the first failing removal; the Project deletion goes leaves first.
        files: [
          'src/main/adapters/project-actions/action-publication-files.ts',
          'src/main/adapters/terminal/terminal-history-moves.ts',
          'src/main/adapters/terminal/terminal-owner-migration.ts',
          'src/main/adapters/terminal/terminal-history-flush.ts',
          'src/main/adapters/terminal/terminal-history-path-cleanup.ts',
          'src/renderer/src/features/sidebar/hooks/sidebar-project-session-deletion.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Closing terminals removes or releases each one's history through the history
        // store's mutation queue, which runs one mutation at a time anyway, and emits each
        // record's `closed` event after its own history settles, in record order.
        files: ['src/main/adapters/terminal/terminal-close-actions.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Each stop persists the run as stopping, signals its process tree, waits for it to
        // exit and persists the result. Runs stop in registration order, starting ones
        // before active ones, and the first failing stop ends the sweep with the remaining
        // runs untouched.
        files: ['src/main/adapters/project-actions/managed-action-runs.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Each write is a compare-and-set transaction on the app database's single SQLite
        // connection, so the writes run one at a time anyway. Deletion recovery also removes
        // Pi session files, and logs each failure against its own Session.
        files: [
          'src/main/adapters/project-actions/preparation-recovery.ts',
          'src/main/adapters/sqlite-session-projection-deletion.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Loops kept one at a time to bound resources. Embedding batches exist to bound the
        // local model's memory and CPU, so sending them together would defeat the batching.
        // Pi session discovery reads every session file of a directory, which can hold
        // thousands, in a background scan.
        files: [
          'src/main/adapters/session-embedding-batches.ts',
          'src/main/adapters/pi/pi-session-discovery.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Each perf run launches a packaged app and measures it. Runs must not overlap, or each
        // measurement would include the other app's CPU and memory load.
        files: ['scripts/perf/lib/perf-app-comparison.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Background housekeeping over directories with many entries (Chromium's code cache
        // alone holds thousands of files). One filesystem call at a time keeps a sweep from
        // queuing thousands of requests on libuv's small thread pool, which the app's own
        // file I/O shares.
        files: [
          'src/main/boot/main-compile-cache.ts',
          'src/main/adapters/electron/electron-chromium-disk-cache.ts',
          'src/main/utils/model-download-temp-sweep.ts',
          'src/main/utils/session-scratch-sweep.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Waits, polls and fallbacks: each turn depends on the one before. A Waggle command
        // waits for the pending owner to settle before it checks again; the desktop bridge's
        // heartbeat, poll pump and shutdown drain wait for their interval or the previous
        // request, and acknowledge released fences one at a time over the same lease; the
        // connection waits for admission before each attempt; login shells are tried in
        // preference order and later ones only spawn when an earlier one gave no PATH.
        files: [
          'src/main/application/explicit-waggle-command-service.ts',
          'src/main/session-host/gui-desktop-service-bridge.ts',
          'src/main/session-host/local-session-connection.ts',
          'src/main/desktop-shell-environment.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Locks and fences are acquired one at a time in a fixed order (sorted repository
        // keys; the Host's fence order), the usual way to keep two callers that need
        // overlapping sets from deadlocking, and the first that fails stops acquisition.
        files: [
          'src/main/services/git/mutation-lock.ts',
          'src/main/session-host/gui-desktop-mutation-fences.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Ordered streams: decoded frames are handled in arrival order, a frame's slices
        // are written to the socket in order behind backpressure, CLI records are written to
        // stdout in order, and terminal input is written in the order it was typed.
        files: [
          'src/main/session-host/local-session-connection-input.ts',
          'src/main/session-host/local-session-server-frame.ts',
          'src/main/sessions-cli-export.ts',
          'src/main/sessions-cli-transcript.ts',
          'src/renderer/src/features/terminal/lib/terminal-input-transport.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Credential recovery handles staged files one at a time: decoding a protected
        // credential goes through the OS credential store, files are marked consumed as they
        // are matched, and the first incompatible file stops recovery with its own error.
        files: ['src/main/session-host/profile-credential-pending.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // The loop is the body of each worker in a bounded pool: at most
        // CANONICAL_DIRECTORY_CONCURRENCY workers share one iterator, and awaiting inside the
        // loop is what bounds the concurrency.
        files: ['src/main/utils/canonical-directory-roots.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // Cookies are set in the order they were read. Two entries can name the same
        // cookie (host, name and path), and the later one has to win, which concurrent
        // writes to the cookie store would not guarantee.
        files: ['src/main/browser-import/browser-cookie-importer.ts'],
        rules: ['react-doctor/async-await-in-loop'],
      },
      {
        // One request at a time on purpose. Each Worktree removal takes the repository's
        // worktree lock and the Host's Workspace fence. Idle browser preview owners are
        // released through the lifecycle queue, and whether one is still retained is checked
        // after the previous release settled. Launch requests are taken and opened one at a
        // time, so each navigation finishes before the next request is read.
        files: [
          'src/renderer/src/features/settings/components/sections/worktrees/use-worktree-removal.ts',
          'src/renderer/src/shell/browser-preview-owner-leases.ts',
          'src/renderer/src/shell/useOpenProjectRequests.ts',
        ],
        rules: ['react-doctor/async-await-in-loop'],
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
        // The scratch directory for the shim is created only once the target directory is
        // pinned, opened and verified. Creating it alongside those checks would leave a stray
        // temporary directory whenever one fails, because its cleanup starts with the `try`
        // that follows.
        files: ['src/main/services/cli-shim-mutation-runner.ts'],
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
      {
        // The reset is in the `finally` block. It is guarded by the request id so a superseded
        // request cannot clear the loading flag of the newer request that replaced it; the
        // newer request, or cancel(), owns that flag. The analyzer only accepts an
        // unconditional reset there.
        files: ['src/renderer/src/shared/ui/useProjectCatalog.ts'],
        rules: ['react-doctor/no-loading-flag-reset-outside-finally'],
      },
      {
        // displayOwner cannot be derived from owner: while a draft becomes a Session it keeps
        // the draft owner until migrateTerminalOwner has moved the draft's terminals, so the
        // panel never shows the Session's owner key without them. Whether to hold is decided
        // by takeDraftMaterialization, which consumes a one-shot receipt and so cannot run
        // during render.
        files: ['src/renderer/src/shell/WorkspaceTerminal.tsx'],
        rules: ['react-doctor/no-derived-state', 'react-doctor/no-derived-state-effect'],
      },
      {
        // No state goes to a parent. useSaveQueueValues and useSaveQueueLifecycle are two
        // halves of one hook in one component; the `context` setters the effect calls are
        // that component's own useState setters. The effect also writes the refs the save
        // queue reads from timers and IPC callbacks, which render must not write.
        files: ['src/renderer/src/features/workspace-files/hooks/useWorkspaceFileSaveQueue.ts'],
        rules: ['react-doctor/no-pass-live-state-to-parent'],
      },
    ],
  },
}

export default config
