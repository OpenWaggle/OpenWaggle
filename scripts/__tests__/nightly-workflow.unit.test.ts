import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = process.cwd()
const WORKFLOW = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/nightly.yml'), 'utf8')

describe('nightly packaged canary workflow', () => {
  it('is non-gating: schedule + workflow_dispatch triggers, read-only permissions, never publishes', () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}schedule:/mu)
    expect(WORKFLOW).toContain('workflow_dispatch:')
    expect(WORKFLOW).toContain('permissions:\n  contents: read')
    expect(WORKFLOW).not.toContain('--publish always')
    expect(WORKFLOW).not.toContain('id-token')
  })

  it('builds, packages, and smokes on all three OSes', () => {
    for (const label of ['label: macOS', 'label: Linux', 'label: Windows']) {
      expect(WORKFLOW).toContain(label)
    }
    expect(WORKFLOW).toContain('run: pnpm build')
    expect(WORKFLOW).toContain('pnpm exec electron-builder ${{ matrix.build_flags }}')
    expect(WORKFLOW).toContain('run: pnpm packaged-app:smoke')
    expect(WORKFLOW).toContain('CSC_IDENTITY_AUTO_DISCOVERY: false')
    // Package a real release identity, not the dev fallback.
    expect(WORKFLOW).toContain('OPENWAGGLE_RELEASE_CHANNEL: stable')
  })

  it('installs, exercises, and uninstalls the Windows artifact before release day', () => {
    expect(WORKFLOW).toContain('- name: Verify Windows installer')
    expect(WORKFLOW).toContain("if: matrix.label == 'Windows'")
    expect(WORKFLOW).toContain(
      'pnpm exec tsx scripts/verify-windows-installer.ts "$installerPath"',
    )
  })

  it('pins every third-party action to a commit SHA, like the other workflows', () => {
    const actionUses = [...WORKFLOW.matchAll(/uses:\s*(\S+)/gu)].map((match) => match[1])
    expect(actionUses.length).toBeGreaterThan(0)
    for (const use of actionUses) {
      // Local composite actions are path refs; third-party actions must be SHA-pinned.
      if (use.startsWith('./')) continue
      expect(use).toMatch(/@[0-9a-f]{40}$/u)
    }
  })
})
