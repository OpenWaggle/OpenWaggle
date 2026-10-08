import { describe, expect, it } from 'vitest'
import { collectPiRuntimeAlignmentProblems } from '../check-pi-runtime-alignment'
import { alignedInput, installedPackages, version } from './pi-runtime-alignment.test-support'

/*
 * Temporary Pi minimumReleaseAgeExclude entries: exactly the matched release at one exact version,
 * and an expiry marker that ends them.
 */
describe('Pi release-age exclusions', () => {
  function withoutExclusionEntries(workspace: string) {
    return workspace.replace(
      installedPackages.map((name) => `  - @earendil-works/${name}@${version}`).join('\n'),
      '',
    )
  }

  it('accepts all release-age exclusions being removed after they expire', () => {
    const input = alignedInput()
    const workspace = withoutExclusionEntries(input.workspace).replace(
      '  # pi-runtime-release-age-exclusions-expire: 2026-10-12T22:00:00Z\n',
      '',
    )
    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toEqual([])
  })

  it('reports an expiry marker left behind after its exclusion entries were removed', () => {
    const input = alignedInput()
    const workspace = withoutExclusionEntries(input.workspace)

    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toEqual([
      expect.stringContaining('pi-runtime-release-age-exclusions-expire line has no'),
    ])
  })

  it('fails once the temporary release-age exclusions are no longer needed', () => {
    const removeEntries = expect.stringContaining(
      'Remove the temporary Pi minimumReleaseAgeExclude entries',
    )
    // The last 1.0.4 package was published at 21:51:59Z, so the exclusions stay until 22:00Z.
    expect(
      collectPiRuntimeAlignmentProblems({ ...alignedInput(), now: new Date('2026-10-12T21:59:59Z') }),
    ).not.toContainEqual(removeEntries)
    expect(
      collectPiRuntimeAlignmentProblems({ ...alignedInput(), now: new Date('2026-10-12T22:00:00Z') }),
    ).toContainEqual(removeEntries)
  })

  it('reads a date-only expiry as midnight UTC', () => {
    const input = alignedInput()
    const workspace = input.workspace.replace('2026-10-12T22:00:00Z', '2026-10-13')
    const removeEntries = expect.stringContaining(
      'Remove the temporary Pi minimumReleaseAgeExclude entries',
    )

    expect(
      collectPiRuntimeAlignmentProblems({ ...input, workspace, now: new Date('2026-10-12T23:59:59Z') }),
    ).not.toContainEqual(removeEntries)
    expect(
      collectPiRuntimeAlignmentProblems({ ...input, workspace, now: new Date('2026-10-13T00:00:00Z') }),
    ).toContainEqual(removeEntries)
  })

  it.each(['2026-10-12T22:00', '2026-10-12 22:00:00Z', '2026-13-12', '2026-02-30', 'soon'])(
    'rejects the expiry %s',
    (expiry) => {
      const input = alignedInput()
      const workspace = input.workspace.replace('2026-10-12T22:00:00Z', expiry)

      expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toContainEqual(
        expect.stringContaining('pi-runtime-release-age-exclusions-expire'),
      )
    },
  )

  it.each([
    '"@earendil-works/*"',
    '"@earendil-works/pi-*"',
    "'@earendil-works/pi-ai@^1.0.4'",
    '@earendil-works/pi-ai',
    '@earendil-works/pi-ai@1.0.x',
  ])('rejects the release-age exclusion %s, which is not one exact version', (entry) => {
    const input = alignedInput()
    const workspace = input.workspace.replace(
      'minimumReleaseAgeExclude:\n',
      `minimumReleaseAgeExclude:\n  - "hono@4.13.7"\n  - ${entry}\n`,
    )

    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toContainEqual(
      expect.stringContaining('exact version'),
    )
  })

  it('rejects a wildcard even when it is the only Pi exclusion', () => {
    const input = alignedInput()
    const workspace = input.workspace
      .replace(
        installedPackages.map((name) => `  - @earendil-works/${name}@${version}`).join('\n'),
        '  - "@earendil-works/*"',
      )
      .replace('  # pi-runtime-release-age-exclusions-expire: 2026-10-12T22:00:00Z\n', '')

    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toContainEqual(
      expect.stringContaining('exact version'),
    )
  })

  it('leaves other packages in the release-age exclusions to the other checks', () => {
    const input = alignedInput()
    const workspace = input.workspace.replace(
      'minimumReleaseAgeExclude:\n',
      'minimumReleaseAgeExclude:\n  - "@diegogbrisa/*"\n  - hono@4.13.7\n',
    )

    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toEqual([])
  })

  it('requires temporary release-age exclusions to say when they expire', () => {
    const input = alignedInput()
    const workspace = input.workspace.replace(
      '  # pi-runtime-release-age-exclusions-expire: 2026-10-12T22:00:00Z\n',
      '',
    )

    expect(collectPiRuntimeAlignmentProblems({ ...input, workspace })).toContainEqual(
      expect.stringContaining('pi-runtime-release-age-exclusions-expire'),
    )
  })

})
