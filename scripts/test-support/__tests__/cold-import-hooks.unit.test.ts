import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { coldImportHookFindings } from '../cold-import-hooks'

function findingsOf(source: string) {
  return coldImportHookFindings('fixture.component.test.tsx', source).map((finding) => finding.reason)
}

describe('cold imports in component test hooks', () => {
  it('rejects a dynamic import in beforeEach, which the first test pays for under the hook deadline', () => {
    expect(
      findingsOf(`beforeEach(async () => {\n  reset()\n  ;({ hook } = await import('../hook'))\n})`),
    ).toEqual(['beforeEach'])
    expect(findingsOf(`beforeEach(async () => {\n  ;({ hook } = await loadHook())\n})`)).toEqual([
      'beforeEach',
    ])
  })

  it('rejects a beforeAll import that keeps the default hook deadline', () => {
    expect(findingsOf(`beforeAll(async () => {\n  await import('../Palette')\n})`)).toEqual([
      'beforeAll-without-timeout',
    ])
  })

  it('accepts a beforeAll import with an explicit deadline and cheap per-test resets', () => {
    expect(
      findingsOf(
        `beforeAll(async () => {\n  await import('../Palette')\n}, COLD_IMPORT_TIMEOUT_MS)\nbeforeEach(() => {\n  reset()\n})`,
      ),
    ).toEqual([])
  })

  it('finds none in the component tier', () => {
    const roots = ['src', 'packages']
    const files = roots.flatMap((root) =>
      fs
        .readdirSync(root, { recursive: true })
        .map(String)
        .filter((file) => file.endsWith('.component.test.tsx'))
        .map((file) => path.join(root, file)),
    )
    expect(files.length).toBeGreaterThan(100)
    const findings = files.flatMap((file) =>
      coldImportHookFindings(file, fs.readFileSync(file, 'utf8')),
    )
    expect(findings).toEqual([])
  })
})
