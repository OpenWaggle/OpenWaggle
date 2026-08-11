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
    readonly overrides?: readonly {
      readonly files: readonly string[]
      readonly rules?: readonly string[]
    }[]
  }
}

const config: DoctorConfig = {
  ignore: {
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
    ],
  },
}

export default config
