import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8')

describe('desktop app release publication', () => {
  it('publishes update blockmaps for differential downloads and never the builder debug dump', () => {
    const uploads = WORKFLOW.match(/name: (?:macos|windows)-artifacts\n\s+path: \|(?:\n\s+dist\/\S+)+/gu)
    expect(uploads?.map((upload) => upload.includes('dist/*.blockmap'))).toEqual([true, true])
    expect(WORKFLOW).toContain("-o -name '*.blockmap' -o \\( -name '*.yml' ! -name 'builder-debug.yml' \\)")
  })

  it('lets only Stable app releases become the GitHub Latest release', () => {
    expect(WORKFLOW).toContain(
      "make_latest: ${{ contains(needs.version.outputs.new_version, '-') && 'false' || 'true' }}",
    )
  })

  it('guards Stable promotion against content that differs from the last release candidate', () => {
    expect(WORKFLOW).toMatch(
      /verify-promotion \\\n\s+--target "\$RELEASE_TARGET_VERSION" \\\n\s+--candidate HEAD/u,
    )
    expect(WORKFLOW).toMatch(
      /verify_version_only_tree "\$parent_sha" "\$commit_sha"\n\s+pnpm exec tsx scripts\/app-release-state\.ts verify-promotion \\\n\s+--target "\$VERSION" \\\n\s+--candidate "\$commit_sha"/u,
    )
  })
})
