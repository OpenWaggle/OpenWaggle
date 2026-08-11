import { describe, expect, it } from 'vitest'
import {
  createYarnTrustPolicy,
  parseMinimumReleaseAgeExclusions,
} from '../package-smoke-trust-policy'

describe('package smoke trust policy', () => {
  it('maps pnpm age-gate exceptions into Yarn preapprovals', () => {
    const exclusions = parseMinimumReleaseAgeExclusions(`
packages:
  - packages/*
minimumReleaseAgeExclude:
  - "@earendil-works/pi-coding-agent@0.81.1"
  - react@19.2.8
`)

    expect(createYarnTrustPolicy(exclusions)).toBe(`nodeLinker: node-modules

npmPreapprovedPackages:
  - "@earendil-works/pi-coding-agent@0.81.1"
  - "react@19.2.8"
`)
  })

  it('rejects malformed exclusion policies instead of disabling the age gate', () => {
    expect(() => parseMinimumReleaseAgeExclusions('minimumReleaseAgeExclude: disabled\n')).toThrow(
      'minimumReleaseAgeExclude as a sequence',
    )
  })
})
