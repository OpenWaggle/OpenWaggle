import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** R6 P3-5: the minified bundles' hidden source maps are kept, but never published or packaged. */
const WORKFLOW = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8')

describe('desktop app release source maps', () => {
  it('keeps the hidden source maps as artifacts, never as release assets', () => {
    for (const platform of ['macos', 'linux', 'windows']) {
      const upload = WORKFLOW.slice(WORKFLOW.indexOf(`name: ${platform}-source-maps`))
      expect(upload).toMatch(/^name: \S+\n\s+path: out\/\*\*\/\*\.map\n/u)
    }
    // The publish job's download, the last one, collects the release assets.
    const publish = WORKFLOW.slice(WORKFLOW.lastIndexOf('actions/download-artifact@'))
    expect(publish.slice(0, publish.indexOf('\n\n'))).toContain("pattern: '*-artifacts'")
  })
})
