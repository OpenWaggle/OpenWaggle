import { describe, expect, it } from 'vitest'
import {
  ERROR_REPORT_BUILT_IN_ERROR_TYPES,
  isExternalErrorReportFrame,
  isOwnErrorReportCodeLocation,
  scrubErrorReportCodeLocation,
  scrubErrorReportDebugMeta,
  scrubErrorReportExceptionType,
  scrubErrorReportFrameLocation,
  scrubErrorReportText,
} from '../error-report-rules'

/** The two paths review N3 found surviving both scrubbers, before and after the home rule. */
const PI_EXTENSION = '/Users/alice/work/acme-secret/.pi/extensions/foo/index.ts'
const WORKTREE =
  '/Users/alice/.openwaggle/worktrees/AcmeSecretProject/805f340d-0cab-4efc-9fbd-bd8e4605749e/src/sync.ts'
/** Review N11's single-file Pi extension, named by its author. */
const SINGLE_FILE_EXTENSION = '/Users/alice/.pi/agent/extensions/acme-jira-sync.ts'

describe('code locations', () => {
  it('keep the app’s own code, Node.js code and native code as they are', () => {
    for (const location of [
      'app:///out/main/index.js',
      'app:///node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js',
      'node:internal/process/task_queues',
      'node:electron/js2c/browser_init',
      'openwaggle://app/assets/index-Bx1.js',
      '<anonymous>',
      '<data:text/javascript>',
      'index 0',
      'index 12',
      'native',
      '[native code]',
      '',
    ]) {
      expect(isOwnErrorReportCodeLocation(location)).toBe(true)
      expect(scrubErrorReportCodeLocation(location)).toBe(location)
    }
  })

  it('reduce every other location to <external>, whatever names its folders or file', () => {
    expect(scrubErrorReportCodeLocation(WORKTREE)).toBe('<external>')
    expect(scrubErrorReportCodeLocation(scrubErrorReportText(WORKTREE))).toBe('<external>')
    expect(scrubErrorReportCodeLocation(SINGLE_FILE_EXTENSION)).toBe('<external>')
    expect(
      scrubErrorReportCodeLocation(
        "C:\\Users\\Sean O'Brien\\.openwaggle\\worktrees\\AcmeSecretProject\\a1\\x.ts",
      ),
    ).toBe('<external>')
    expect(
      scrubErrorReportCodeLocation('file:///Volumes/Work/acme/.pi/extensions/foo.mjs?v=2#top'),
    ).toBe('<external>')
    expect(scrubErrorReportCodeLocation('openwaggle-extension://runtime/acme-tools/main.js')).toBe(
      '<external>',
    )
    expect(scrubErrorReportCodeLocation('internal/process/task_queues')).toBe('<external>')
    expect(scrubErrorReportCodeLocation('/work/index 0/x.js')).toBe('<external>')
    expect(scrubErrorReportCodeLocation('index 0.js')).toBe('<external>')
    expect(scrubErrorReportCodeLocation('/x/index.acme-secret.ts')).toBe('<external>')
  })

  it('keep only the name of an entry module, which names nothing', () => {
    expect(scrubErrorReportCodeLocation(PI_EXTENSION)).toBe('<external>/index.ts')
    expect(scrubErrorReportCodeLocation(scrubErrorReportText(PI_EXTENSION))).toBe(
      '<external>/index.ts',
    )
    expect(scrubErrorReportCodeLocation('C:\\work\\acme\\dist\\index.mjs?v=1')).toBe(
      '<external>/index.mjs',
    )
  })

  it('are stable when scrubbed twice', () => {
    for (const location of [PI_EXTENSION, WORKTREE]) {
      const once = scrubErrorReportCodeLocation(location)

      expect(isOwnErrorReportCodeLocation(once)).toBe(false)
      expect(scrubErrorReportCodeLocation(once)).toBe(once)
    }
  })
})

describe('stack frames and debug images', () => {
  it('rewrite an external frame, its function and module, and leave an app frame alone', () => {
    const external = {
      filename: '~/work/acme-secret/.pi/extensions/foo/index.ts',
      abs_path: PI_EXTENSION,
      module: 'acme-secret.pi.extensions.foo:index',
      function: 'syncAcme',
      lineno: 4,
    }
    const own = { filename: 'app:///out/main/index.js', module: 'index', function: 'boot' }

    expect(isExternalErrorReportFrame(external)).toBe(true)
    expect(isExternalErrorReportFrame(own)).toBe(false)
    scrubErrorReportFrameLocation(external)
    scrubErrorReportFrameLocation(own)

    expect(external).toEqual({
      filename: '<external>/index.ts',
      abs_path: '<external>/index.ts',
      function: '<external>',
      lineno: 4,
    })
    expect(own).toEqual({ filename: 'app:///out/main/index.js', module: 'index', function: 'boot' })
    expect(isExternalErrorReportFrame(external)).toBe(true)
  })

  it('rewrite the code files of external debug images and keep their ids', () => {
    const debugMeta = {
      images: [
        { type: 'sourcemap', code_file: 'app:///out/main/index.js', debug_id: 'a-b' },
        { type: 'sourcemap', code_file: WORKTREE, debug_id: 'c-d' },
        { type: 'macho', code_file: '/Users/alice/acme/libfoo.dylib', debug_file: PI_EXTENSION },
        'not an image',
      ],
    }

    scrubErrorReportDebugMeta(debugMeta)
    scrubErrorReportDebugMeta(undefined)

    expect(debugMeta.images).toEqual([
      { type: 'sourcemap', code_file: 'app:///out/main/index.js', debug_id: 'a-b' },
      { type: 'sourcemap', code_file: '<external>', debug_id: 'c-d' },
      { type: 'macho', code_file: '<external>', debug_file: '<external>/index.ts' },
      'not an image',
    ])
  })
})

describe('exception types', () => {
  const thrownBy = (filename: string) => ({ stacktrace: { frames: [{ filename }] } })

  it('keep a built-in error type wherever it was thrown', () => {
    for (const type of [
      'TypeError',
      'AggregateError',
      'DOMException',
      'AbortError',
      'SystemError',
    ]) {
      const exception = { type, ...thrownBy(SINGLE_FILE_EXTENSION) }

      scrubErrorReportExceptionType(exception)

      expect(ERROR_REPORT_BUILT_IN_ERROR_TYPES.has(type)).toBe(true)
      expect(exception.type).toBe(type)
    }
  })

  it("keep the app's own error type when the app's code threw it", () => {
    const fromMain = { type: 'SettingsStoreReadError', ...thrownBy('app:///out/main/index.js') }
    const fromRenderer = { type: 'RouteLoadError', ...thrownBy('openwaggle://app/assets/a.js') }
    const fromProvider = {
      type: 'RateLimitError',
      ...thrownBy('app:///node_modules/openai/core.js'),
    }

    for (const exception of [fromMain, fromRenderer, fromProvider]) {
      const type = exception.type
      scrubErrorReportExceptionType(exception)
      expect(exception.type).toBe(type)
    }
  })

  it('report any other type as Error, judged by the frame that threw', () => {
    const external = { type: 'AcmeJiraSyncError', ...thrownBy(SINGLE_FILE_EXTENSION) }
    const thrownLast = {
      type: 'AcmeJiraSyncError',
      stacktrace: {
        frames: [{ filename: 'app:///out/main/index.js' }, { filename: SINGLE_FILE_EXTENSION }],
      },
    }
    const pseudo = { type: 'AcmeJiraSyncError', ...thrownBy('<anonymous>') }
    const withoutStack = { type: 'AcmeJiraSyncError' }

    for (const exception of [external, thrownLast, pseudo, withoutStack]) {
      scrubErrorReportExceptionType(exception)
      expect(exception.type).toBe('Error')
    }
  })
})
