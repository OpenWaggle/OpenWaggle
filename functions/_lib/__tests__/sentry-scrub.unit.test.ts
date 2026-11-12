import { describe, expect, it } from 'vitest'
import { ERROR_CODE_META } from '../../../src/shared/domain/error-classifier'
import { AGENT_ERROR_CODES, errorCode } from '../sentry-message'
import {
  allowlistedContexts,
  forwardedEnvelopeHeader,
  scrubJsonRecord,
  scrubSentryEvent,
} from '../sentry-scrub'
import { scrubReportText } from '../sentry-text'

const EVENT_ID = 'b'.repeat(32)

describe('error report text', () => {
  it.each([
    ['/Users/alice/Projects/app.ts', '~/Projects/app.ts'],
    ['at run (/home/bob/work/index.js:1:2)', 'at run (~/work/index.js:1:2)'],
    ['file:///Users/alice/Library/x', 'file://~/Library/x'],
    ['C:\\Users\\John Smith\\AppData\\Roaming', '~\\AppData\\Roaming'],
    ["C:\\Users\\Sean O'Brien\\Documents\\x", '~\\Documents\\x'],
    ['c:/users/bob/repo', '~/repo'],
    ['C:\\\\Users\\\\carol\\\\x', '~\\\\x'],
    ['Error in C:\\Users\\Bob Smith', 'Error in ~'],
    ['C:\\Users\\bob\n    at main', '~\n    at main'],
    ['\\/Users\\/dave\\/x', '~\\/x'],
    ['open "/Users/erin" failed', 'open "~" failed'],
    ['\\\\wsl.localhost\\Ubuntu\\home\\alice\\repo', '~\\repo'],
    ['\\\\wsl$\\Debian\\home\\alice', '~'],
    ['//wsl.localhost/Ubuntu/home/alice/x', '~/x'],
    ["/mnt/c/Users/Sean O'Brien/repo", '~/repo'],
    ['/System/Volumes/Data/Users/alice/x', '~/x'],
    ['/var/folders/x5/kv9_n3d0bj1y2s8q0000gn/T/foo.txt', '<tmp>/T/foo.txt'],
    ['/private/var/folders/x5/kv9_n3d0bj1y2s8q0000gn/T', '<tmp>/T'],
    ['C:\\Users\\bob\\AppData\\Local\\Temp\\x.tmp', '<tmp>\\x.tmp'],
    ['C:\\Windows\\Temp\\setup.log', '<tmp>\\setup.log'],
    ['/tmp/ow-scratch-501/19fa3e03/8f05657d931b/log.txt', '/tmp/<scratch>/log.txt'],
    ['/tmp/ow-scratch-501/19fa3e03/evidence/8f05657d931b/a.png', '/tmp/<scratch>/a.png'],
    ['/private/tmp/ow-scratch-501/19fa3e03', '/private/tmp/<scratch>'],
    ['C:\\Users\\Public\\Documents', 'C:\\Users\\Public\\Documents'],
    ['/Users/Shared/x', '/Users/Shared/x'],
    ['Run 4f2c9a1e-5b6d-4c7e-8f90-123456789abc failed', 'Run <id> failed'],
    ['token 0123456789ABCDEF0123 refused', 'token <hex> refused'],
    ['commit a1b2c3d4', 'commit a1b2c3d4'],
    ['https://example.com/home/page', 'https://example.com/home/page'],
    ['/usr/local/bin/node', '/usr/local/bin/node'],
  ])('%s -> %s', (input, expected) => {
    expect(scrubReportText(input)).toBe(expected)
  })

  it('scrubs every nested string and key', () => {
    expect(
      scrubJsonRecord({
        list: ['/home/a/x', 3, null],
        nested: { '/Users/b/y': { deep: '/Users/c' } },
      }),
    ).toEqual({ list: ['~/x', 3, null], nested: { '~/y': { deep: '~' } } })
  })

  it('refuses a value nested too deeply to scrub', () => {
    let value: Record<string, unknown> = { leaf: '/Users/alice' }
    for (let depth = 0; depth < 80; depth += 1) value = { child: value }

    expect(scrubJsonRecord(value)).toBeUndefined()
    expect(scrubSentryEvent(value)).toBeUndefined()
  })
})

describe('error event scrubbing', () => {
  it('drops the user, machine name, request, breadcrumbs and modules', () => {
    expect(
      scrubSentryEvent({
        user: { ip_address: '203.0.113.7' },
        server_name: 'alice-laptop',
        request: { url: 'app://-/#/sessions/1', headers: { Cookie: 'a' } },
        breadcrumbs: [{ message: 'x' }],
        modules: { electron: '43' },
        level: 'error',
      }),
    ).toEqual({ level: 'error' })
  })

  it('keeps only OS, architecture, app version and runtime versions from contexts', () => {
    expect(
      allowlistedContexts({
        os: { name: 'Windows', version: '11', kernel_version: '10.0.26100', build: 'x' },
        device: { arch: 'x64', name: 'DESKTOP-ALICE', memory_size: 1, boot_time: 'x' },
        app: { app_version: '1.0.0', app_start_time: 'x', app_memory: 2 },
        culture: { locale: 'en-GB', timezone: 'Europe/London' },
        gpu: { name: 'GPU' },
        trace: { trace_id: 'x' },
      }),
    ).toEqual({
      os: { name: 'Windows', version: '11' },
      device: { arch: 'x64' },
      app: { app_version: '1.0.0' },
    })
  })

  it('drops local variables and source lines from every stack frame', () => {
    const frame = {
      function: 'f',
      vars: { a: 1 },
      context_line: 'x',
      pre_context: ['y'],
      post_context: ['z'],
    }
    const scrubbed = scrubSentryEvent({
      exception: { values: [{ stacktrace: { frames: [frame] } }] },
      threads: { values: [{ stacktrace: { frames: [frame] } }] },
      stacktrace: { frames: [frame] },
    })

    expect(scrubbed).toEqual({
      exception: { values: [{ stacktrace: { frames: [{ function: 'f' }] } }] },
      threads: { values: [{ stacktrace: { frames: [{ function: 'f' }] } }] },
      stacktrace: { frames: [{ function: 'f' }] },
    })
  })

  it('never rewrites the event id, the release or debug ids, which Sentry needs as they are', () => {
    const debugId = '4f2c9a1e-5b6d-4c7e-8f90-123456789abc'
    expect(
      scrubSentryEvent({
        event_id: EVENT_ID,
        release: 'openwaggle@1.0.0+0123456789abcdef',
        debug_meta: { images: [{ debug_id: debugId, code_file: '/Users/alice/app.js' }] },
        tags: { session: debugId },
      }),
    ).toEqual({
      event_id: EVENT_ID,
      release: 'openwaggle@1.0.0+0123456789abcdef',
      debug_meta: { images: [{ debug_id: debugId, code_file: '<external>' }] },
      tags: { session: '<id>' },
    })
  })

  it('keeps no folder or file name of code outside the app, which can name a private project', () => {
    const frames = [
      {
        filename: '/Users/alice/work/acme-secret/.pi/extensions/foo/index.ts',
        module: 'acme-secret.foo',
        function: 'run',
      },
      {
        abs_path: '/Users/alice/.openwaggle/worktrees/AcmeSecretProject/4f2c/src/tool.ts',
        filename: 'tool.ts',
      },
      { filename: 'app:///out/main/index.js', module: 'main', function: 'start' },
      { filename: 'node:internal/process/task_queues', function: 'processTicksAndRejections' },
      { filename: 'native' },
    ]
    const scrubbed = scrubSentryEvent({ exception: { values: [{ stacktrace: { frames } }] } })

    expect(scrubbed).toEqual({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                { filename: '<external>/index.ts', function: '<external>' },
                { abs_path: '<external>', filename: '<external>' },
                { filename: 'app:///out/main/index.js', module: 'main', function: 'start' },
                {
                  filename: 'node:internal/process/task_queues',
                  function: 'processTicksAndRejections',
                },
                { filename: 'native' },
              ],
            },
          },
        ],
      },
    })
    expect(JSON.stringify(scrubbed)).not.toMatch(/acme|AcmeSecret/iu)
  })

  it("keeps no name from a single-file Pi extension's error, frames or functions", () => {
    const extension = '/Users/alice/.pi/agent/extensions/acme-jira-sync.ts'
    const scrubbed = scrubSentryEvent({
      exception: {
        values: [
          {
            type: 'AcmeJiraSyncError',
            stacktrace: {
              frames: [
                { filename: 'app:///out/main/index.js', function: 'runExtensionCommand' },
                { filename: extension, function: 'AcmeJiraClient.syncSprintForProjectFalcon' },
                { filename: extension, function: 'deployFalconToProdCluster' },
              ],
            },
          },
          { type: 'RateLimitError', stacktrace: { frames: [{ filename: 'app:///x.js' }] } },
        ],
      },
    })

    expect(scrubbed).toEqual({
      exception: {
        values: [
          {
            type: 'Error',
            stacktrace: {
              frames: [
                { filename: 'app:///out/main/index.js', function: 'runExtensionCommand' },
                { filename: '<external>', function: '<external>' },
                { filename: '<external>', function: '<external>' },
              ],
            },
          },
          { type: 'RateLimitError', stacktrace: { frames: [{ filename: 'app:///x.js' }] } },
        ],
      },
    })
    expect(JSON.stringify(scrubbed)).not.toMatch(/acme|jira|falcon/iu)
  })

  it('reduces the message text of an unhandled error to its type and code', () => {
    expect(
      scrubSentryEvent({
        message: 'Unexpected token in my secret prompt',
        logentry: { message: 'ENOENT: no such file %s', params: ['/Users/alice/x'] },
        exception: {
          values: [
            { type: 'Error', value: 'ENOENT: no such file, open notes.txt' },
            {
              type: 'TypeError',
              value: "Cannot read properties of undefined (reading 'secret')",
              mechanism: { type: 'onuncaughtexception', handled: false },
            },
          ],
        },
        extra: { input: 'my secret prompt' },
      }),
    ).toEqual({
      message: 'unknown',
      logentry: { message: 'ENOENT' },
      exception: {
        values: [
          { type: 'Error', value: 'ENOENT' },
          {
            type: 'TypeError',
            value: 'unknown',
            mechanism: { type: 'onuncaughtexception', handled: false },
          },
        ],
      },
    })
  })

  it('keeps message text only for a handled error the app reported as its own', () => {
    const report = (tags: object, values: object[]) =>
      scrubSentryEvent({ tags, exception: { values } })?.exception
    const application = { 'openwaggle.error_origin': 'application' }
    const handled = { value: 'Saving failed', mechanism: { handled: true } }

    expect(report(application, [handled])).toEqual({ values: [handled] })
    expect(report({}, [handled])).toEqual({ values: [{ ...handled, value: 'unknown' }] })
    expect(report({ 'openwaggle.error_origin': 'tool-execution' }, [handled])).toEqual({
      values: [{ ...handled, value: 'unknown' }],
    })
    expect(
      report(application, [{ value: 'cause', mechanism: { handled: false } }, handled]),
    ).toEqual({
      values: [
        { value: 'unknown', mechanism: { handled: false } },
        { ...handled, value: 'unknown' },
      ],
    })
  })
})

describe('error codes', () => {
  it.each([
    ['rate-limited', 'rate-limited'],
    ['ECONNRESET', 'ECONNRESET'],
    ['ERR_STREAM_PREMATURE_CLOSE', 'ERR_STREAM_PREMATURE_CLOSE'],
    ['http-503', 'http-503'],
    ['EACCES: permission denied, open ~/x', 'EACCES'],
    ['secret-project-name', 'unknown'],
    [undefined, 'unknown'],
  ])('%s -> %s', (text, code) => {
    expect(errorCode(text)).toBe(code)
  })

  it("knows every code of the app's error classifier", () => {
    expect([...AGENT_ERROR_CODES].sort()).toEqual(Object.keys(ERROR_CODE_META).sort())
  })
})

describe('forwarded envelope header', () => {
  it('replaces the placeholder DSN, drops the trace context and keeps the event id', () => {
    expect(
      forwardedEnvelopeHeader(
        {
          event_id: EVENT_ID,
          sent_at: '2026-10-02T00:00:00Z',
          dsn: 'https://openwaggle@openwaggle.ai/1',
          trace: { public_key: 'openwaggle', user_segment: 'x' },
          sdk: { name: 'sentry.javascript.electron', version: '7.20.0' },
        },
        'https://key@o1.ingest.de.sentry.io/2',
      ),
    ).toEqual({
      event_id: EVENT_ID,
      sent_at: '2026-10-02T00:00:00Z',
      sdk: { name: 'sentry.javascript.electron', version: '7.20.0' },
      dsn: 'https://key@o1.ingest.de.sentry.io/2',
    })
  })
})
