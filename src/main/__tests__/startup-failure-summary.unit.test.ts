import { ERROR_REPORT_ORIGIN_TAG } from '@shared/error-reporting/error-report-constants'
import { isStartupFailureSummaryMessage } from '@shared/error-reporting/error-report-rules'
import { scrubErrorReportEvent } from '@shared/error-reporting/error-report-scrubbing'
import { describe, expect, it } from 'vitest'
import { StartupFailureSummary } from '../startup-failure-summary'

class LocalSessionClientTimeoutError extends Error {
  override readonly name = 'LocalSessionClientTimeoutError'
}

class WindowsUserOnlySecurityError extends Error {
  override readonly name = 'WindowsUserOnlySecurityError'
  constructor(
    readonly stage: string,
    readonly exitCode: number | null,
    readonly signalCode: string | null,
  ) {
    super('Windows user-only security verification failed: C:\\Users\\Jürgen\\private stderr')
  }
}

describe('Session Host startup failure summary', () => {
  it('names each error type in the chain with the Windows helper stage, exit code and signal', () => {
    const helper = new WindowsUserOnlySecurityError('compile', null, 'SIGTERM')
    const summary = new StartupFailureSummary(
      'session-host',
      new Error('Session Host stopped', { cause: helper }),
    )

    expect(summary.name).toBe('SessionHostFatalError')
    expect(summary.message).toBe(
      'session-host: Error <- WindowsUserOnlySecurityError stage=compile signal=SIGTERM',
    )
    expect(summary.cause).toBeUndefined()
  })

  it('never copies message text, stderr or stack messages into the report', () => {
    const helper = new WindowsUserOnlySecurityError('compile', 1, null)
    helper.stack = `WindowsUserOnlySecurityError: failed\nC:\\Users\\Jürgen\\secret line\n    at secure (file.js:1:1)`
    const summary = new StartupFailureSummary('gui-session-host-start', helper)

    expect(summary.message).toBe(
      'gui-session-host-start: WindowsUserOnlySecurityError stage=compile exit=1',
    )
    expect(summary.stack).not.toContain('Jürgen')
    expect(summary.stack).toContain('    at secure (file.js:1:1)')
  })

  it('keeps Node.js codes and Win32 codes, and drops values that do not look like them', () => {
    const launch = Object.assign(new Error('launch failed'), {
      name: 'WindowsHeadlessLaunchError',
      stage: 'create-process',
      win32Code: 5,
      exitCode: 1,
    })
    const refused = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
    const odd = Object.assign(new Error('odd'), {
      name: 'not a type name',
      code: 'C:\\Users\\me',
      stage: 'Has Spaces And Caps',
      exitCode: 'one',
    })

    expect(new StartupFailureSummary('gui-bootstrap', launch).message).toBe(
      'gui-bootstrap: WindowsHeadlessLaunchError stage=create-process exit=1 win32=5',
    )
    expect(new StartupFailureSummary('gui-bootstrap', refused).message).toBe(
      'gui-bootstrap: Error code=ECONNREFUSED',
    )
    expect(new StartupFailureSummary('gui-bootstrap', odd).message).toBe('gui-bootstrap: Error')
  })

  it('reports an error class from code outside the app as Error, without its helper-like facts', () => {
    const extension = Object.assign(new Error('billing failed'), {
      name: 'AcmeInternalBillingError',
      stage: 'charge',
      exitCode: 7,
      code: 'EACCES',
    })
    const spoofedType = Object.assign(new Error('x'), { name: 'TypeError', stage: 'read-input' })

    expect(
      new StartupFailureSummary('session-host', new Error('stopped', { cause: extension })).message,
    ).toBe('session-host: Error <- Error code=EACCES')
    expect(new StartupFailureSummary('session-host', spoofedType).message).toBe(
      'session-host: TypeError',
    )
    const settings = Object.assign(new Error('read failed'), { name: 'SettingsStoreReadError' })
    expect(new StartupFailureSummary('session-host', settings).message).toBe(
      'session-host: SettingsStoreReadError',
    )
  })

  it('survives the report scrubbers whole, network codes and HTTP-like exit codes included', () => {
    const summaries = [
      new StartupFailureSummary(
        'gui-session-host-start',
        Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      ),
      new StartupFailureSummary(
        'session-host',
        Object.assign(new Error('launch'), {
          name: 'WindowsHeadlessLaunchError',
          stage: 'create-process',
          exitCode: 503,
          win32Code: 4_294_967_295,
        }),
      ),
      new StartupFailureSummary('gui-bootstrap', 'text'),
    ]
    for (const summary of summaries) {
      expect(isStartupFailureSummaryMessage(summary.message)).toBe(true)
      const event = {
        exception: {
          values: [
            {
              type: summary.name,
              value: summary.message,
              mechanism: { type: 'generic', handled: true },
            },
          ],
        },
        tags: { [ERROR_REPORT_ORIGIN_TAG]: 'application' },
      }
      scrubErrorReportEvent(event)
      expect(event.exception.values[0]?.value).toBe(summary.message)
      expect(event.tags[ERROR_REPORT_ORIGIN_TAG]).toBe('application')
    }
  })

  it('follows a restart wrapper’s failure and bounds the chain', () => {
    const restart = Object.assign(new Error('restart required'), {
      name: 'GuiStartupRestartRequiredError',
      failure: new LocalSessionClientTimeoutError('Timed out'),
    })
    expect(new StartupFailureSummary('gui-session-host-start', restart).message).toBe(
      'gui-session-host-start: GuiStartupRestartRequiredError <- LocalSessionClientTimeoutError',
    )

    const looped = new Error('loop')
    Object.assign(looped, { cause: looped })
    expect(new StartupFailureSummary('session-host', looped).message).toBe('session-host: Error')
    expect(new StartupFailureSummary('session-host', 'text').message).toBe(
      'session-host: non-error value',
    )
  })
})
