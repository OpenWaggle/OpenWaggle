/**
 * React Doctor configuration.
 *
 * Policy: no blanket rule disables, and no suppression of a finding that could be
 * fixed in code. Every override below is a verified false positive, scoped to the
 * single file + single rule it applies to, with the reason it cannot be fixed.
 *
 * Types are declared inline rather than imported from 'react-doctor': the tool
 * runs via npx and is deliberately not a project dependency.
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
         * Verified by removing both and reinstalling: pnpm then hoisted newer
         * transitive copies (cluster 0.60.2 / workflow 0.19.1) which demanded newer
         * @effect/platform, rpc, sql and effect, turning one pre-existing unmet peer
         * into four. Removal makes the tree worse, so this cannot be fixed in code.
         *
         * Note this override is necessarily rule-wide: package.json is the only file
         * `unused-dev-dependency` can fire on. Re-test with `pnpm peers check` if the
         * @effect ecosystem versions are ever realigned.
         */
        files: ['package.json'],
        rules: ['deslop/unused-dev-dependency'],
      },
      {
        /*
         * This file is the MCP orchestration-expression security boundary. The rule
         * matches the string literal 'WebSocket' on line 11, which is an entry in
         * FORBIDDEN_ORCHESTRATION_IDENTIFIERS - a deny-list the parsers consult to
         * *reject* those identifiers (see mcp-orchestration-parser.ts). There is no
         * bridge here; the flagged token exists precisely to forbid one.
         */
        files: ['src/main/adapters/pi/mcp-orchestration-expression-parser.ts'],
        rules: ['react-doctor/local-rpc-native-bridge-risk'],
      },
      {
        // `String.prototype.includes`, not `Array.prototype.includes`: these do
        // substring matching (a free-text tree-filter query, and error-message
        // fragment matching). A Set gives O(1) equality lookups and cannot
        // perform substring matching, so the suggested fix does not apply.
        files: [
          'src/renderer/src/features/session-tree/lib/session-tree-filter.ts',
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
        // attribute. The rule misses it because the element's `ref` is a callback
        // used to arm the watchdog before assigning the custom-protocol `src`.
        files: ['src/renderer/src/features/chat/components/InlineVisualization.tsx'],
        rules: ['react-doctor/iframe-missing-sandbox'],
      },
    ],
  },
}

export default config
