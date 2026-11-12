import { describe, expect, it } from 'vitest'
import {
  createYarnTrustPolicy,
  parseMinimumReleaseAgeExclusions,
} from '../package-smoke-trust-policy'

describe('package smoke trust policy', () => {
  it('maps Bun age-gate exceptions into Yarn preapprovals', () => {
    const exclusions = parseMinimumReleaseAgeExclusions(`
[install]
minimumReleaseAge = 604800
minimumReleaseAgeExcludes = [
  # A comment between entries.
  "@earendil-works/pi-coding-agent@0.81.1",
  'react@19.2.8',
]
`)

    expect(createYarnTrustPolicy(exclusions)).toBe(`nodeLinker: node-modules

npmPreapprovedPackages:
  - "@earendil-works/pi-coding-agent@0.81.1"
  - "react@19.2.8"
`)
  })

  it('rejects malformed exclusion policies instead of disabling the age gate', () => {
    expect(() =>
      parseMinimumReleaseAgeExclusions('[install]\nminimumReleaseAgeExcludes = "disabled"\n'),
    ).toThrow('install.minimumReleaseAgeExcludes as an array of strings')
  })
})
