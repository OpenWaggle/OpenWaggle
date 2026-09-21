import { describe, expect, it } from 'vitest'
import { makeDesktopNativeAdmission } from '../desktop-native-admission'

describe('desktop native admission quarantine', () => {
  it('leaves native admission unchanged before quarantine', () => {
    const admission = makeDesktopNativeAdmission()
    expect(admission.getIssue()).toBeNull()
    expect(() => admission.assertAdmission()).not.toThrow()
  })

  it('retains its first reason for the entire GUI process lifetime', () => {
    const admission = makeDesktopNativeAdmission()
    admission.quarantine('Previous desktop ownership remains uncertain.')
    admission.quarantine('A later connection recovered.')
    expect(admission.getIssue()).toBe('Previous desktop ownership remains uncertain.')
    expect(() => admission.assertAdmission()).toThrow(
      'Previous desktop ownership remains uncertain.',
    )
  })

  it('uses a clear bounded reason when input is blank or oversized', () => {
    const empty = makeDesktopNativeAdmission()
    empty.quarantine('  ')
    expect(empty.getIssue()).toContain('Sessions remain available')
    const oversized = makeDesktopNativeAdmission()
    oversized.quarantine('a'.repeat(5000))
    expect(oversized.getIssue()).toHaveLength(4096)
  })
})
