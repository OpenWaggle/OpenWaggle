import {
  prepareQaProfileRemoval,
  shutdownSessionHostForQa,
} from './qa/session-host-shutdown'

interface QaEvidencePage {
  isClosed(): boolean
  screenshot(options: { readonly path: string }): Promise<unknown>
}

export async function captureRequiredQaEvidence(page: QaEvidencePage | null, screenshotPath: string) {
  if (page === null || page.isClosed()) {
    throw new Error('Electron QA ended before its required final screenshot could be captured.')
  }
  await page.screenshot({ path: screenshotPath })
}

interface ElectronQaSessionHostShutdownDependencies {
  readonly shutdownHost: typeof shutdownSessionHostForQa
  readonly prepareProfileRemoval: typeof prepareQaProfileRemoval
}

/**
 * Drains the QA profile's Session Host through its authenticated version-handoff path and clears
 * the profile while holding the Host's ownership, so no Host keeps its SQLite files open after the
 * launcher deletes the profile. The Host is detached and outlives the Electron process group.
 */
export function stopElectronQaSessionHost(
  profilePath: string,
  dependencies: ElectronQaSessionHostShutdownDependencies = {
    shutdownHost: shutdownSessionHostForQa,
    prepareProfileRemoval: prepareQaProfileRemoval,
  },
) {
  return dependencies.shutdownHost(profilePath, (ownership) =>
    dependencies.prepareProfileRemoval(profilePath, ownership),
  )
}

/**
 * Every step runs even when an earlier one fails. The Host goes last: while Electron still runs,
 * it would start a new Host for the one that stopped.
 */
export async function completeElectronQaShutdown(input: {
  readonly captureEvidence: () => Promise<void>
  readonly closeConnection: () => Promise<void>
  readonly stopChild: () => Promise<void>
  readonly stopSessionHost: () => Promise<void>
}) {
  const errors: unknown[] = []
  for (const operation of [
    input.captureEvidence,
    input.closeConnection,
    input.stopChild,
    input.stopSessionHost,
  ]) {
    try {
      await operation()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Electron QA shutdown failed.')
}
