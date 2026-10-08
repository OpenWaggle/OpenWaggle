import { describe, expect, it, vi } from 'vitest'
import {
  DesktopNativeRecoveryUnavailableError,
  makeDesktopNativeAdmission,
} from '../desktop-native-admission'

describe('desktop native admission quarantine', () => {
  it('leaves native admission unchanged before quarantine', async () => {
    const admission = makeDesktopNativeAdmission()
    expect(admission.getIssue()).toBeNull()
    expect(() => admission.assertAdmission()).not.toThrow()
    expect(await admission.recover()).toEqual({ outcome: 'recovered' })
  })

  it('retains its first reason until a recovery succeeds', () => {
    const admission = makeDesktopNativeAdmission()
    admission.quarantine({ reason: 'Previous desktop ownership remains uncertain.' })
    admission.quarantine({ reason: 'A later connection recovered.' })
    expect(admission.getIssue()).toBe('Previous desktop ownership remains uncertain.')
    expect(() => admission.assertAdmission()).toThrow(
      'Previous desktop ownership remains uncertain.',
    )
  })

  it('uses a clear bounded reason that names what the user attests to', () => {
    const empty = makeDesktopNativeAdmission()
    empty.quarantine({ reason: '  ' })
    expect(empty.getIssue()).toContain('Sessions remain available')
    expect(empty.getIssue()).toContain('dev server')
    const oversized = makeDesktopNativeAdmission()
    oversized.quarantine({ reason: 'a'.repeat(5000) })
    expect(oversized.getIssue()).toHaveLength(4096)
  })

  it('lifts quarantine only through the recovery its caller offered, once at a time', async () => {
    const admission = makeDesktopNativeAdmission()
    const recover = vi.fn(async () => {})
    admission.quarantine({ recover })
    const [first, second] = await Promise.all([admission.recover(), admission.recover()])
    expect(first).toEqual({ outcome: 'recovered' })
    expect(second).toEqual({ outcome: 'recovered' })
    expect(recover).toHaveBeenCalledOnce()
    expect(admission.getIssue()).toBeNull()
    expect(() => admission.assertAdmission()).not.toThrow()
  })

  it('stays quarantined and reports a retryable failure', async () => {
    const admission = makeDesktopNativeAdmission()
    const recover = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Host refused'))
      .mockResolvedValueOnce()
    admission.quarantine({ recover })
    expect(await admission.recover()).toEqual({
      outcome: 'failed',
      message: 'Host refused',
      retryable: true,
    })
    expect(admission.getIssue()).not.toBeNull()
    expect(await admission.recover()).toEqual({ outcome: 'recovered' })
    expect(admission.getIssue()).toBeNull()
  })

  it('bounds and redacts the failure it publishes to the renderer', async () => {
    const admission = makeDesktopNativeAdmission()
    admission.quarantine({
      recover: async () => {
        throw new Error(`Desktop tools could not be recovered. Reason: ${'x'.repeat(80_000)}`)
      },
    })
    const outcome = await admission.recover()
    if (outcome.outcome !== 'failed') throw new Error('Expected a failure')
    expect(outcome.message.length).toBeLessThanOrEqual(601)
    expect(outcome.message.startsWith('Desktop tools could not be recovered.')).toBe(true)
  })

  it('marks a failure that cannot succeed from this window as not retryable', async () => {
    const admission = makeDesktopNativeAdmission()
    admission.quarantine({
      recover: async () => {
        throw new DesktopNativeRecoveryUnavailableError('OpenWaggle is quitting.')
      },
    })
    expect(await admission.recover()).toEqual({
      outcome: 'failed',
      message: 'OpenWaggle is quitting.',
      retryable: false,
    })
  })

  it('refuses recovery when none was offered', async () => {
    const admission = makeDesktopNativeAdmission()
    admission.quarantine({ reason: 'Uncertain ownership.' })
    expect(await admission.recover()).toMatchObject({
      outcome: 'failed',
      retryable: false,
      message: expect.stringContaining('Quit and reopen OpenWaggle'),
    })
    expect(admission.getIssue()).toBe('Uncertain ownership.')
  })
})
