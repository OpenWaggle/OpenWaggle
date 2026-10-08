import type { DesktopNativeRecoveryOutcome } from '@shared/types/openwaggle-desktop-api'
import { userFacingErrorDetail } from './utils/describe-error'

const DEFAULT_QUARANTINE_REASON =
  'Desktop tools are paused. The previous OpenWaggle window closed without confirming that what it started had stopped. Sessions remain available, but terminals, browser previews, archiving or deleting sessions, and removing worktrees are unavailable. If nothing you started from its terminals is still running, such as a dev server, a file watcher, or a background job, and no Git operation was interrupted, choose Recover desktop tools.'
const MAX_REASON_LENGTH = 4096
const NO_RECOVERY_MESSAGE =
  'Desktop tools cannot be recovered from this window. Quit and reopen OpenWaggle.'

type DesktopNativeRecovery = () => Promise<void>

/** A recovery that cannot succeed from this window; retrying it would only repeat the failure. */
export class DesktopNativeRecoveryUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DesktopNativeRecoveryUnavailableError'
  }
}

/**
 * A transport reconnect or lease timeout cannot prove that old native children exited, so only
 * an explicit user attestation, through the recovery the quarantining caller offers, lifts it.
 */
export function makeDesktopNativeAdmission() {
  let issue: string | null = null
  let recovery: DesktopNativeRecovery | null = null
  let recovering: Promise<DesktopNativeRecoveryOutcome> | null = null

  async function attempt(offered: DesktopNativeRecovery): Promise<DesktopNativeRecoveryOutcome> {
    try {
      await offered()
    } catch (error) {
      return {
        outcome: 'failed',
        // Published to the renderer: redacted and bounded like other user-facing Host failures.
        message: userFacingErrorDetail(
          error instanceof Error ? error.message : 'Desktop tools could not be recovered.',
        ),
        retryable: !(error instanceof DesktopNativeRecoveryUnavailableError),
      }
    }
    issue = null
    recovery = null
    return { outcome: 'recovered' }
  }

  return {
    quarantine(
      options: { readonly reason?: string; readonly recover?: DesktopNativeRecovery } = {},
    ) {
      if (issue !== null) return
      issue = options.reason?.trim().slice(0, MAX_REASON_LENGTH) || DEFAULT_QUARANTINE_REASON
      recovery = options.recover ?? null
    },
    assertAdmission() {
      if (issue !== null) throw new Error(issue)
    },
    getIssue: (): string | null => issue,
    /** Runs the offered recovery one at a time; a failed attempt stays quarantined. */
    recover(): Promise<DesktopNativeRecoveryOutcome> {
      if (issue === null) return Promise.resolve({ outcome: 'recovered' })
      const offered = recovery
      if (offered === null) {
        return Promise.resolve({
          outcome: 'failed',
          message: NO_RECOVERY_MESSAGE,
          retryable: false,
        })
      }
      recovering ??= attempt(offered).finally(() => {
        recovering = null
      })
      return recovering
    },
  }
}

// This state belongs to the GUI process, not the renderer or detached Session Host.
const admission = makeDesktopNativeAdmission()
export const quarantineDesktopNativeAdmission = admission.quarantine
export const assertDesktopNativeAdmission = admission.assertAdmission
export const getDesktopNativeAdmissionIssue = admission.getIssue
export const recoverDesktopNativeAdmission = admission.recover
