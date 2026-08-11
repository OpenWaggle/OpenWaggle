/**
 * React Doctor configuration.
 *
 * Policy: no blanket rule disables. Every entry here is a documented false
 * positive where the tool's reachability model cannot see a real, deliberate
 * consumer. Genuine findings are fixed in source, never suppressed.
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
    ],
  },
}

export default config
