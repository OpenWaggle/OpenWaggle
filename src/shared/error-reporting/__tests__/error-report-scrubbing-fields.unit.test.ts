import { describe, expect, it } from 'vitest'
import { ERROR_REPORT_ORIGIN_TAG } from '../error-report-constants'
import { type ErrorReportEvent, scrubErrorReportEvent } from '../error-report-scrubbing'

const HANDLED = { type: 'generic', handled: true }
const UNHANDLED = { type: 'auto.browser.global_handlers.onerror', handled: false }
const APPLICATION_TAGS = { [ERROR_REPORT_ORIGIN_TAG]: 'application' }

function scrubbed(event: ErrorReportEvent, options: Parameters<typeof scrubErrorReportEvent>[1]) {
  scrubErrorReportEvent(event, options)
  return event
}

describe('scrubErrorReportEvent fields', () => {
  it('drops user, request, breadcrumbs, source lines, local variables and identifying context', () => {
    const event = scrubbed(
      {
        user: { id: 'u1', ip_address: '203.0.113.7' },
        request: { url: 'openwaggle://renderer/index.html#/sessions/1' },
        server_name: 'alices-macbook',
        breadcrumbs: [{ message: 'clicked' }],
        modules: { react: '19.3.0' },
        extra: { __serialized__: { prompt: 'secret' }, kept: 'yes' },
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'x is undefined',
              mechanism: HANDLED,
              stacktrace: {
                frames: [
                  {
                    vars: { apiKey: 'sk-secret' },
                    context_line: 'const apiKey = read()',
                    pre_context: ['// before'],
                    post_context: ['// after'],
                  },
                ],
              },
            },
          ],
        },
        threads: { values: [{ stacktrace: { frames: [{ vars: { token: 'x' } }] } }] },
        contexts: {
          os: { name: 'macOS', version: '15.2', kernel_version: 'Darwin 24.2.0' },
          app: {
            app_version: '1.0.0',
            app_start_time: '2026-10-02T07:00:00Z',
            app_memory: 1,
            free_memory: 1,
            app_name: 'OpenWaggle',
          },
          device: {
            arch: 'arm64',
            family: 'Desktop',
            boot_time: '2026-10-01T07:00:00Z',
            memory_size: 1,
            free_memory: 1,
            name: 'Alice’s MacBook',
          },
          culture: { locale: 'es-ES', timezone: 'Europe/Madrid' },
          trace: { trace_id: '0123456789abcdef0123456789abcdef', span_id: '0123456789abcdef' },
          runtime: { name: 'Electron', version: '43.2.0' },
          chrome: { name: 'Chrome', type: 'runtime', version: '146.0.0.0' },
          openwaggle: { workspace: '/Volumes/Work/acme' },
        },
        tags: APPLICATION_TAGS,
      },
      {},
    )

    expect(event).toEqual({
      extra: { kept: 'yes' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'x is undefined',
            mechanism: HANDLED,
            stacktrace: { frames: [{}] },
          },
        ],
      },
      threads: { values: [{ stacktrace: { frames: [{}] } }] },
      contexts: {
        os: { name: 'macOS', version: '15.2' },
        app: { app_version: '1.0.0' },
        device: { arch: 'arm64' },
        runtime: { name: 'Electron', version: '43.2.0' },
        chrome: { name: 'Chrome', type: 'runtime', version: '146.0.0.0' },
      },
      tags: APPLICATION_TAGS,
    })
  })

  it('scrubs object keys too, but never the event id', () => {
    const event = scrubbed(
      {
        event_id: '0199a1b2c3d47e5f8a9b0c1d2e3f4a5b',
        extra: { '/home/bob/a.txt': 'missing' },
        tags: APPLICATION_TAGS,
        exception: { values: [{ type: 'Error', value: 'x', mechanism: HANDLED }] },
      },
      {},
    )

    expect(event.event_id).toBe('0199a1b2c3d47e5f8a9b0c1d2e3f4a5b')
    expect(event.extra).toEqual({ '~/a.txt': 'missing' })
  })

  it('leaves the text rules to the main process when the renderer asks', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'TypeError',
              value: "cannot open C:\\Users\\Sean O'Brien\\plan.md",
              mechanism: UNHANDLED,
              stacktrace: {
                frames: [
                  { filename: 'openwaggle://app/assets/index-Bx1.js' },
                  { filename: "C:\\Users\\Sean O'Brien\\x.js" },
                ],
              },
            },
          ],
        },
        extra: { cwd: "C:\\Users\\Sean O'Brien" },
        request: { url: 'openwaggle://renderer/index.html' },
        tags: APPLICATION_TAGS,
      },
      { scrubText: false },
    )

    expect(event).toEqual({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'unknown',
            mechanism: UNHANDLED,
            stacktrace: {
              frames: [
                { filename: 'openwaggle://app/assets/index-Bx1.js' },
                { filename: '<external>' },
              ],
            },
          },
        ],
      },
      tags: { [ERROR_REPORT_ORIGIN_TAG]: 'unhandled' },
    })
  })

  it('keeps no name of code outside the app, in any frame or debug image', () => {
    const extension = '/Users/alice/work/acme-secret/.pi/extensions/foo/index.ts'
    const worktree =
      '/Users/alice/.openwaggle/worktrees/AcmeSecretProject/805f340d-0cab-4efc-9fbd-bd8e4605749e/src/sync.ts'
    const appFrame = { filename: 'app:///out/main/index.js', module: 'index', function: 'boot' }
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'Error',
              value: 'x',
              mechanism: HANDLED,
              stacktrace: {
                frames: [
                  { ...appFrame },
                  { filename: extension, abs_path: extension, module: 'foo:index' },
                ],
              },
            },
          ],
        },
        threads: { values: [{ stacktrace: { frames: [{ filename: worktree, module: 'sync' }] } }] },
        stacktrace: { frames: [{ filename: `file://${worktree}` }] },
        debug_meta: { images: [{ type: 'sourcemap', code_file: worktree, debug_id: 'c-d' }] },
        tags: APPLICATION_TAGS,
      },
      { homeDirectory: '/Users/alice' },
    )

    expect(event.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      appFrame,
      { filename: '<external>/index.ts', abs_path: '<external>/index.ts' },
    ])
    expect(event.threads?.values?.[0]?.stacktrace?.frames).toEqual([{ filename: '<external>' }])
    expect(event.stacktrace?.frames).toEqual([{ filename: '<external>' }])
    expect(event.debug_meta).toEqual({
      images: [{ type: 'sourcemap', code_file: '<external>', debug_id: 'c-d' }],
    })
    expect(JSON.stringify(event)).not.toMatch(/acme-secret|AcmeSecretProject|worktrees/u)
  })

  it("keeps no name from a single-file Pi extension's error, frames or functions", () => {
    const extension = '/Users/alice/.pi/agent/extensions/acme-jira-sync.ts'
    const appFrame = { filename: 'app:///out/main/index.js', function: 'runExtensionCommand' }
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'AcmeJiraSyncError',
              value: 'Falcon sprint sync failed',
              mechanism: UNHANDLED,
              stacktrace: {
                frames: [
                  { ...appFrame },
                  {
                    filename: extension,
                    abs_path: extension,
                    module: 'acme-jira-sync',
                    function: 'AcmeJiraClient.syncSprintForProjectFalcon',
                  },
                  { filename: extension, function: 'deployFalconToProdCluster' },
                ],
              },
            },
          ],
        },
      },
      { homeDirectory: '/Users/alice' },
    )

    expect(event.exception?.values).toEqual([
      {
        type: 'Error',
        value: 'unknown',
        mechanism: UNHANDLED,
        stacktrace: {
          frames: [
            appFrame,
            { filename: '<external>', abs_path: '<external>', function: '<external>' },
            { filename: '<external>', function: '<external>' },
          ],
        },
      },
    ])
    expect(JSON.stringify(event)).not.toMatch(/acme|jira|falcon/iu)
  })
})
