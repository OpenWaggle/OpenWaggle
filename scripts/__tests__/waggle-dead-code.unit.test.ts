import { describe, expect, it } from 'vitest'
import { isWaggleScopeFile, waggleDeadCodeFindings } from '../standards/waggle-dead-code'

const NO_IMPORTS = 'export const value = 1\n'

describe('Waggle dead-code scope', () => {
  it('covers the Waggle packages and app files named for Waggle', () => {
    for (const filePath of [
      'packages/pi-waggle/src/loop.ts',
      'packages/waggle-core/src/consensus.ts',
      'packages/pi-waggle/package.json',
      'src/main/application/waggle-run/outcome.ts',
      'src/main/application/waggle-run-service.ts',
      'src/main/adapters/pi/pi-waggle-package-dedupe.ts',
      'src/main/application/explicit-waggle-command-runner.ts',
      'src/shared/types/waggle.ts',
      'src/shared/types/local-session-waggle.ts',
      'src/renderer/src/features/waggle/state/waggle-store.ts',
      'src/renderer/src/features/composer/components/nodes/WaggleMentionNode.ts',
    ]) {
      expect(isWaggleScopeFile(filePath, NO_IMPORTS), filePath).toBe(true)
    }
  })

  it('covers desktop agent policy, which held the consensus detector this check now forbids', () => {
    expect(isWaggleScopeFile('src/main/agent/consensus-detector.ts', NO_IMPORTS)).toBe(true)
  })

  it('covers any app file that imports a Waggle package, whatever its name', () => {
    const importsProtocol = "import { PI_WAGGLE_TURN_CUSTOM_TYPE } from '@openwaggle/pi-waggle/protocol'\n"
    const importsCore = 'const core = await import("@openwaggle/waggle-core")\n'

    expect(isWaggleScopeFile('src/main/store/sessions/node-hydration.ts', importsProtocol)).toBe(true)
    expect(isWaggleScopeFile('src/main/adapters/pi/entry-projections.ts', importsCore)).toBe(true)
  })

  it('leaves out tests, OpenWaggle-named modules, other packages, and unrelated app files', () => {
    for (const filePath of [
      'packages/pi-waggle/src/__tests__/pi-waggle-package.unit.test.ts',
      'src/main/application/waggle-run-service.unit.test.ts',
      'src/main/openwaggle-mcp-server-policy.ts',
      'src/main/adapters/pi/mcp/openwaggle-mcp-migration.ts',
      'src/main/utils/stream-bridge.ts',
      'packages/extension-sdk/src/index.ts',
      'scripts/check-waggle-dead-code.ts',
    ]) {
      expect(isWaggleScopeFile(filePath, NO_IMPORTS), filePath).toBe(false)
    }
    expect(
      isWaggleScopeFile('src/main/utils/stream-bridge.ts', "import type { X } from '@shared/types/waggle'\n"),
    ).toBe(false)
  })
})

function report(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 10,
    unused_files: [],
    unused_exports: [],
    unused_types: [],
    unused_class_members: [],
    unused_enum_members: [],
    unused_dependencies: [],
    type_only_dependencies: [],
    test_only_dependencies: [],
    ...overrides,
  }
}

describe('waggleDeadCodeFindings', () => {
  const scope = new Set([
    'src/main/agent/consensus-detector.ts',
    'packages/pi-waggle/src/loop.ts',
    'packages/waggle-core/src/state.ts',
    'packages/pi-waggle/package.json',
  ])

  it('keeps dead files, exports, members and dependencies in scope and drops the rest', () => {
    const findings = waggleDeadCodeFindings(
      report({
        unused_files: [{ path: 'src/main/agent/consensus-detector.ts' }, { path: 'src/main/other.ts' }],
        unused_exports: [
          { path: 'packages/pi-waggle/src/loop.ts', export_name: 'unusedHelper' },
          { path: 'scripts/release.ts', export_name: 'notWaggle' },
        ],
        unused_class_members: [{ path: 'packages/waggle-core/src/state.ts', member_name: 'reset' }],
        test_only_dependencies: [{ path: 'packages/pi-waggle/package.json', package_name: 'left-pad' }],
        circular_dependencies: [{ files: ['packages/pi-waggle/src/loop.ts'] }],
      }),
      scope,
    )

    expect(findings).toEqual([
      { kind: 'unused_files', path: 'src/main/agent/consensus-detector.ts' },
      { kind: 'unused_exports', path: 'packages/pi-waggle/src/loop.ts', name: 'unusedHelper' },
      { kind: 'unused_class_members', path: 'packages/waggle-core/src/state.ts', name: 'reset' },
      { kind: 'test_only_dependencies', path: 'packages/pi-waggle/package.json', name: 'left-pad' },
    ])
  })

  it('fails instead of passing when fallow changes its report', () => {
    expect(() => waggleDeadCodeFindings([], scope)).toThrow('fallow did not return a JSON report object.')
    expect(() => waggleDeadCodeFindings(report({ schema_version: 11 }), scope)).toThrow(
      'fallow report schema 11 is not 10',
    )
    const { unused_exports: _removed, ...withoutExports } = report()
    expect(() => waggleDeadCodeFindings(withoutExports, scope)).toThrow(
      'fallow report has no unused_exports list.',
    )
  })
})
