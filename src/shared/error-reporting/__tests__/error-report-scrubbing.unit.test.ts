import { describe, expect, it } from 'vitest'
import { ERROR_REPORT_ORIGIN_TAG } from '../error-report-constants'
import {
  type ErrorReportEvent,
  errorReportCode,
  errorReportOrigin,
  scrubErrorReportEvent,
} from '../error-report-scrubbing'

const HANDLED = { type: 'generic', handled: true }
const UNHANDLED = { type: 'auto.node.onunhandledrejection', handled: false }
const APPLICATION_TAGS = { [ERROR_REPORT_ORIGIN_TAG]: 'application' }
/** A provider SDK the app ships, which threw the error: its error class is kept. */
const PROVIDER_SDK_FRAME = { filename: 'app:///node_modules/openai/core.js', function: 'request' }

function scrubbed(event: ErrorReportEvent, options: Parameters<typeof scrubErrorReportEvent>[1]) {
  scrubErrorReportEvent(event, options)
  return event
}

describe('errorReportCode', () => {
  it("uses OpenWaggle's error classification for provider failures", () => {
    expect(errorReportCode('429 Too Many Requests: slow down, user prompt was ...')).toBe(
      'rate-limited',
    )
    expect(errorReportCode('401 Incorrect API key provided: sk-...')).toBe('api-key-invalid')
  })

  it('falls back to the error code, HTTP status or leading Node.js code, then unknown', () => {
    const notFound = Object.assign(new Error("open '/x' failed"), { code: 'ENOENT' })
    expect(errorReportCode(notFound.message, notFound)).toBe('ENOENT')
    expect(errorReportCode('Request failed', { status: 418 })).toBe('http-418')
    expect(errorReportCode("EACCES: permission denied, open '/Volumes/Work/acme/.env'")).toBe(
      'EACCES',
    )
    expect(errorReportCode('The model said something private')).toBe('unknown')
  })

  it('keeps a value that is already a code', () => {
    expect(errorReportCode('rate-limited')).toBe('rate-limited')
    expect(errorReportCode('ERR_STREAM_PREMATURE_CLOSE')).toBe('ERR_STREAM_PREMATURE_CLOSE')
  })
})

describe('scrubErrorReportEvent', () => {
  it('keeps the message of a handled application error and scrubs paths and ids everywhere', () => {
    const event = scrubbed(
      {
        event_id: '0123456789abcdef0123456789abcdef',
        message: 'Failed reading /Users/alice/notes.md',
        exception: {
          values: [
            {
              type: 'Error',
              value: 'Session 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b could not read /Users/alice/x',
              mechanism: HANDLED,
              stacktrace: {
                frames: [
                  {
                    filename: '/Users/alice/.pi/agent/extensions/x.js',
                    abs_path: '/Users/alice/.pi/agent/extensions/x.js',
                    module: 'x',
                  },
                ],
              },
            },
          ],
        },
        extra: { cwd: '/Users/alice/repo', nested: { paths: ['/Users/alice/a', 7] } },
        tags: { ...APPLICATION_TAGS, origin: '/Users/alice' },
      },
      { homeDirectory: '/Users/alice' },
    )

    expect(event).toEqual({
      event_id: '0123456789abcdef0123456789abcdef',
      message: 'Failed reading ~/notes.md',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Session <id> could not read ~/x',
            mechanism: HANDLED,
            stacktrace: {
              frames: [{ filename: '<external>', abs_path: '<external>' }],
            },
          },
        ],
      },
      extra: { cwd: '~/repo', nested: { paths: ['~/a', 7] } },
      tags: { ...APPLICATION_TAGS, origin: '~' },
    })
  })

  it('keeps only the type and code of an error reported without an origin', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'SyntaxError',
              value: `Unexpected token 's', "secret pro"... is not valid JSON`,
              mechanism: HANDLED,
            },
          ],
        },
        extra: { detail: 'the file contents' },
      },
      {},
    )

    expect(event).toEqual({
      exception: { values: [{ type: 'SyntaxError', value: 'unknown', mechanism: HANDLED }] },
    })
  })

  it('drops the text of a tool failure that reached the reporter untagged', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'Error',
              value: 'Edit failed: could not find "const apiKey = load()" in ~/repo/a.ts',
              mechanism: UNHANDLED,
            },
          ],
        },
      },
      {},
    )

    expect(event.exception?.values?.[0]?.value).toBe('unknown')
    expect(JSON.stringify(event)).not.toContain('apiKey')
  })

  it('keeps only the type and code of an unhandled error, and tags it unhandled', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'Error',
              value: "EACCES: permission denied, open '/Volumes/Work/acme/.env'",
              mechanism: UNHANDLED,
            },
          ],
        },
        tags: APPLICATION_TAGS,
      },
      {},
    )

    expect(event.exception?.values).toEqual([
      { type: 'Error', value: 'EACCES', mechanism: UNHANDLED },
    ])
    expect(event.tags).toEqual({ [ERROR_REPORT_ORIGIN_TAG]: 'unhandled' })
  })

  it('keeps only the type and code of an error from tool execution', () => {
    const toolError = Object.assign(new Error('cat: ~/diary.txt: Dear diary...'), {
      code: 'ENOENT',
    })
    const event = scrubbed(
      {
        message: 'tool failed with the file contents',
        logentry: { message: 'tool failed with %s', params: ['the file contents'] },
        exception: { values: [{ type: 'Error', value: toolError.message, mechanism: HANDLED }] },
        extra: { output: 'the file contents' },
        tags: { [ERROR_REPORT_ORIGIN_TAG]: 'tool-execution' },
      },
      { originalException: toolError },
    )

    expect(event).toEqual({
      message: 'unknown',
      logentry: { message: 'unknown' },
      exception: { values: [{ type: 'Error', value: 'ENOENT', mechanism: HANDLED }] },
      tags: { [ERROR_REPORT_ORIGIN_TAG]: 'tool-execution' },
    })
  })

  it('treats an application error classified as a provider failure as a provider response', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            { type: 'Error', value: 'socket hang up while sending my private prompt' },
            {
              type: 'Error',
              value: '429 Rate limit reached for gpt-5 in organization org-abc: "my prompt"',
              mechanism: HANDLED,
            },
          ],
        },
        tags: APPLICATION_TAGS,
      },
      {},
    )

    expect(event.exception?.values).toEqual([
      { type: 'Error', value: 'unknown' },
      { type: 'Error', value: 'rate-limited', mechanism: HANDLED },
    ])
    expect(event.tags).toEqual({ [ERROR_REPORT_ORIGIN_TAG]: 'provider-response' })
  })

  it('treats provider SDK error classes as provider failures', () => {
    const event = scrubbed(
      {
        exception: {
          values: [
            {
              type: 'BadRequestError',
              value: "400 Invalid 'content': my private text",
              mechanism: HANDLED,
              stacktrace: { frames: [PROVIDER_SDK_FRAME] },
            },
          ],
        },
        tags: APPLICATION_TAGS,
      },
      { originalException: { status: 400 } },
    )

    expect(event.exception?.values).toEqual([
      {
        type: 'BadRequestError',
        value: 'http-400',
        mechanism: HANDLED,
        stacktrace: { frames: [PROVIDER_SDK_FRAME] },
      },
    ])
    expect(errorReportOrigin(event)).toBe('provider-response')
  })

  it('reduces a captured message to a code', () => {
    const event = scrubbed(
      { message: "'GPU' process exited with 'crashed'", tags: APPLICATION_TAGS },
      {},
    )

    expect(event.message).toBe('unknown')
    expect(event.tags).toEqual(APPLICATION_TAGS)
  })
})
