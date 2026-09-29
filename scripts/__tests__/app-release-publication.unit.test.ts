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

  it('guards every Stable version before a release PR exists and again before tagging', () => {
    expect(WORKFLOW).toMatch(
      /app-release-notes\.ts check --version "\$VERSION"[\s\S]*?verify-promotion \\\n\s+--target "\$VERSION" \\\n\s+--candidate HEAD\n\s+fi\n\n\s+RELEASE_BRANCH=/u,
    )
    expect(WORKFLOW).toMatch(
      /verify_version_only_tree "\$parent_sha" "\$commit_sha"\n\s+pnpm exec tsx scripts\/app-release-state\.ts verify-promotion \\\n\s+--target "\$VERSION" \\\n\s+--candidate "\$commit_sha"/u,
    )
  })

  it('lets an ordinary merge wait for its CHANGELOG entry but fails a dispatch or release commit', () => {
    expect(WORKFLOW).toContain(
      'if [ -z "$RELEASE_TARGET_VERSION" ] && [ "$RELEASE_SUBJECT_VERSION" != "$VERSION" ]; then',
    )
    expect(WORKFLOW).toContain('waits for its CHANGELOG.md entry; no release PR was prepared.')
  })

  it('publishes Stable releases with their CHANGELOG entry and fails before tagging without one', () => {
    expect(WORKFLOW).toContain('scripts/app-release-notes.ts write')
    expect(WORKFLOW).toContain(
      "generate_release_notes: ${{ contains(needs.version.outputs.new_version, '-') }}",
    )
    expect(WORKFLOW).toContain("format('{0}/release-notes.md', runner.temp)")
  })

  it('refuses to build unsigned release candidate or Stable macOS artifacts', () => {
    const guard = WORKFLOW.indexOf('name: Require macOS signing for release candidates and Stable')
    const build = WORKFLOW.indexOf('name: Build macOS artifacts (arm64 + x64)')
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(build)
    expect(WORKFLOW).toMatch(/rc\|stable\)\n\s+if \[ "\$MACOS_SIGNING_CONFIGURED" != "true" \] \|\| \[ "\$MACOS_NOTARIZATION_CONFIGURED" != "true" \]; then/u)
  })
})
