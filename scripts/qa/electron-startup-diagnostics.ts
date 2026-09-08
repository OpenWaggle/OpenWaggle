import type { ChildProcess } from 'node:child_process'

const STARTUP_DIAGNOSTIC_TEXT_LIMIT = 4_096

export function electronStartupErrorMessage(error: unknown) {
  return (error instanceof Error ? error.stack ?? error.message : String(error)).slice(
    0,
    STARTUP_DIAGNOSTIC_TEXT_LIMIT,
  )
}

/** Observe Playwright's existing GUI pipe only until startup settles. Never pipe the detached Host. */
export function captureElectronStartupDiagnostics(
  child: Pick<ChildProcess, 'stderr' | 'pid' | 'exitCode' | 'signalCode'>,
) {
  let stderrTail = ''
  const collect = (chunk: Buffer | string) => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-STARTUP_DIAGNOSTIC_TEXT_LIMIT)
  }
  child.stderr?.on('data', collect)
  return {
    stop: () => child.stderr?.removeListener('data', collect),
    snapshot: (error: unknown) => ({
      error: electronStartupErrorMessage(error),
      pid: child.pid ?? null,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      stderrTail,
    }),
  }
}
