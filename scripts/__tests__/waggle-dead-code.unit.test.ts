import { describe, expect, it } from 'vitest'
import { isWaggleScopePath, waggleDeadCodeFindings } from '../standards/waggle-dead-code'

describe('Waggle dead-code scope', () => {
  it('covers the Waggle packages and the desktop Waggle modules', () => {
    for (const filePath of [
      'packages/pi-waggle/src/loop.ts',
      'packages/waggle-core/src/consensus.ts',
      'packages/pi-waggle/package.json',
      'src/main/application/waggle-run/outcome.ts',
      'src/main/application/waggle-run-service.ts',
      'src/main/adapters/pi/agent-kernel/waggle-run.ts',
      'src/main/adapters/pi/pi-waggle-package-dedupe.ts',
      'src/main/application/explicit-waggle-command-runner.ts',
      'src/main/ipc/waggle-handler.ts',
    ]) {
      expect(isWaggleScopePath(filePath), filePath).toBe(true)
    }
  })

  it('leaves out tests, OpenWaggle-named modules, and the rest of the app', () => {
    for (const filePath of [
      'packages/pi-waggle/src/__tests__/pi-waggle-package.unit.test.ts',
      'src/main/openwaggle-mcp-server-policy.ts',
      'src/main/adapters/pi/mcp/openwaggle-mcp-migration.ts',
      'src/main/agent/title-generator.ts',
      'src/renderer/src/features/waggle/state/waggle-store.ts',
      'packages/extension-sdk/src/index.ts',
    ]) {
      expect(isWaggleScopePath(filePath), filePath).toBe(false)
    }
  })
})

describe('waggleDeadCodeFindings', () => {
  it('keeps dead files, exports, members and dependencies in scope and drops the rest', () => {
    const report = {
      unused_files: [
        { path: 'src/main/agent/consensus-detector.ts' },
        { path: 'src/main/application/waggle-run/old-policy.ts' },
      ],
      unused_exports: [
        { path: 'packages/pi-waggle/src/loop.ts', export_name: 'unusedHelper' },
        { path: 'scripts/release.ts', export_name: 'notWaggle' },
      ],
      unused_class_members: [
        { path: 'packages/waggle-core/src/state.ts', member_name: 'reset' },
      ],
      unused_dependencies: [{ path: 'packages/pi-waggle/package.json', package_name: 'left-pad' }],
      circular_dependencies: [{ files: ['packages/pi-waggle/src/a.ts'] }],
    }

    expect(waggleDeadCodeFindings(report)).toEqual([
      { kind: 'unused_files', path: 'src/main/application/waggle-run/old-policy.ts' },
      { kind: 'unused_exports', path: 'packages/pi-waggle/src/loop.ts', name: 'unusedHelper' },
      { kind: 'unused_class_members', path: 'packages/waggle-core/src/state.ts', name: 'reset' },
      { kind: 'unused_dependencies', path: 'packages/pi-waggle/package.json', name: 'left-pad' },
    ])
  })

  it('refuses a report that is not a JSON object', () => {
    expect(() => waggleDeadCodeFindings([])).toThrow('fallow did not return a JSON report object.')
  })
})
