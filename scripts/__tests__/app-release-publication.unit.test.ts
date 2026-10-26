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
    expect(WORKFLOW).toContain(
      "RELEASE_LATEST: ${{ contains(needs.version.outputs.new_version, '-') && 'false' || 'true' }}",
    )
  })

  it('uploads to a draft, verifies it, and only then publishes', () => {
    const steps = [
      '- name: Find an already published release',
      '- name: Upload GitHub Release as a draft',
      '- name: Verify draft release assets',
      '- name: Publish GitHub Release',
      '- name: Verify published release assets',
    ].map((step) => WORKFLOW.indexOf(step))
    expect(steps.every((index) => index > 0)).toBe(true)
    expect([...steps].sort((left, right) => left - right)).toEqual(steps)
    const upload = WORKFLOW.slice(steps[1], steps[2])
    expect(upload).toContain('draft: true')
    expect(WORKFLOW).not.toContain('draft: false')
    expect(WORKFLOW.slice(steps[2], steps[3])).toContain('scripts/verify-release-assets.ts')
    expect(WORKFLOW.slice(steps[3], steps[4])).toContain(
      'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false',
    )
    expect(WORKFLOW.slice(steps[3], steps[4])).toContain('--latest="$RELEASE_LATEST"')
    expect(WORKFLOW.slice(steps[4])).toContain('--dir release --published')
    // A rerun after publication only verifies; it never re-uploads over a published release.
    for (const step of [upload, WORKFLOW.slice(steps[2], steps[3]), WORKFLOW.slice(steps[3], steps[4])]) {
      expect(step).toContain("if: steps.existing-release.outputs.published != 'true'")
    }
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

  it('verifies that both DMGs are signed, notarized and stapled, not only the apps', () => {
    const verify = WORKFLOW.slice(
      WORKFLOW.indexOf('name: Verify macOS signing and notarization'),
      WORKFLOW.indexOf('name: Prepare macOS update channels'),
    )
    expect(verify).toContain('dmgs=(dist/*.dmg)')
    expect(verify).toContain('[ "${#dmgs[@]}" -eq 2 ]')
    expect(verify).toContain('codesign --verify --strict --verbose=2 "$dmg"')
    expect(verify).toContain('xcrun stapler validate "$dmg"')
    expect(verify).toContain('spctl --assess --type open --context context:primary-signature --verbose "$dmg"')
  })

  it('refuses to build unsigned release candidate or Stable macOS artifacts', () => {
    const guard = WORKFLOW.indexOf('name: Require macOS signing for release candidates and Stable')
    const build = WORKFLOW.indexOf('name: Build macOS artifacts (arm64 + x64)')
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(build)
    expect(WORKFLOW).toMatch(/rc\|stable\)\n\s+if \[ "\$MACOS_SIGNING_CONFIGURED" != "true" \] \|\| \[ "\$MACOS_NOTARIZATION_CONFIGURED" != "true" \]; then/u)
  })
})
