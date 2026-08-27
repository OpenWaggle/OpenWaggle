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

export async function completeElectronQaShutdown(input: {
  readonly captureEvidence: () => Promise<void>
  readonly closeConnection: () => Promise<void>
  readonly stopChild: () => Promise<void>
}) {
  const errors: unknown[] = []
  for (const operation of [input.captureEvidence, input.closeConnection, input.stopChild]) {
    try {
      await operation()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Electron QA shutdown failed.')
}
