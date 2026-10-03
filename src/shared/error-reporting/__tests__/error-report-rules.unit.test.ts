import { describe, expect, it } from 'vitest'
import { ERROR_REPORT_ORIGIN_TAG } from '../error-report-constants'
import {
  createErrorReportPathScrubber,
  createErrorReportTextScrubber,
  hasUnhandledErrorReportException,
  keepsErrorReportMessageText,
  leadingNodeErrorCode,
  scrubErrorReportPaths,
  scrubErrorReportText,
} from '../error-report-rules'

describe('error report text rules', () => {
  it('replaces macOS and Linux home directories where a path starts', () => {
    expect(scrubErrorReportText("ENOENT: open '/Users/alice/.ssh/id_ed25519'")).toBe(
      "ENOENT: open '~/.ssh/id_ed25519'",
    )
    expect(scrubErrorReportText('file:///Users/alice/Library/x.js')).toBe('file://~/Library/x.js')
    expect(scrubErrorReportText('PATH=/usr/bin:/Users/alice/.local/bin')).toBe(
      'PATH=/usr/bin:~/.local/bin',
    )
    expect(scrubErrorReportText('cwd=/home/bob/projects/app')).toBe('cwd=~/projects/app')
    expect(scrubErrorReportText('(/home/bob)')).toBe('(~)')
    expect(scrubErrorReportText('/var/home/sam/x.js')).toBe('~/x.js')
    expect(scrubErrorReportText('/System/Volumes/Data/Users/alice/repo')).toBe('~/repo')
    expect(scrubErrorReportText('{"\\/Users\\/bob\\/x": 1}')).toBe('{"~\\/x": 1}')
  })

  it("replaces root's home directory but not other folders named root", () => {
    expect(scrubErrorReportText('/root/.pi/agent/settings.json')).toBe('~/.pi/agent/settings.json')
    expect(scrubErrorReportText('(/root)')).toBe('(~)')
    expect(scrubErrorReportText('/rootfs/x')).toBe('/rootfs/x')
    expect(scrubErrorReportText('https://example.dev/root/a')).toBe('https://example.dev/root/a')
  })

  it('leaves URL paths, package folders and shared folders alone', () => {
    expect(scrubErrorReportText('GET https://example.com/home/page failed')).toBe(
      'GET https://example.com/home/page failed',
    )
    expect(scrubErrorReportText('node_modules/home/index.js')).toBe('node_modules/home/index.js')
    expect(scrubErrorReportText('/Users/Shared/OpenWaggle/log.txt')).toBe(
      '/Users/Shared/OpenWaggle/log.txt',
    )
    expect(scrubErrorReportText('C:\\Users\\Public\\Documents')).toBe(
      'C:\\Users\\Public\\Documents',
    )
    expect(scrubErrorReportText('C:\\Users\\Default User\\x')).toBe('C:\\Users\\Default User\\x')
  })

  it('replaces whole Windows profile names, with spaces or apostrophes', () => {
    expect(scrubErrorReportText("C:\\Users\\Sean O'Brien\\AppData\\x.js")).toBe('~\\AppData\\x.js')
    expect(scrubErrorReportText('C:\\Users\\Maria de la Cruz Lopez\\proj\\x')).toBe('~\\proj\\x')
    expect(scrubErrorReportText('C:\\Users\\bob: access denied')).toBe('~: access denied')
    expect(scrubErrorReportText('c:/users/carol/source/repo')).toBe('~/source/repo')
    expect(scrubErrorReportText('{"path":"C:\\\\Users\\\\carol\\\\a.txt"}')).toBe(
      '{"path":"~\\\\a.txt"}',
    )
    expect(scrubErrorReportText('file:///C:/Users/carol/app/main.js')).toBe('file:///~/app/main.js')
    expect(scrubErrorReportText('\\\\server\\c$\\Users\\carol\\x')).toBe('\\\\server\\c$~\\x')
  })

  it('replaces WSL home directories', () => {
    expect(scrubErrorReportText('\\\\wsl.localhost\\Ubuntu-22.04\\home\\bob\\proj\\x.ts')).toBe(
      '~\\proj\\x.ts',
    )
    expect(scrubErrorReportText('\\\\wsl$\\Ubuntu\\home\\bob\\x')).toBe('~\\x')
    expect(scrubErrorReportText('//wsl.localhost/Ubuntu/root/x')).toBe('~/x')
    expect(scrubErrorReportText("/mnt/c/Users/Sean O'Brien/proj")).toBe('~/proj')
  })

  it('replaces temporary and OpenWaggle scratch folders', () => {
    expect(scrubErrorReportText('/private/var/folders/73/f2h1abc_xyz/T/push.log')).toBe(
      '<tmp>/T/push.log',
    )
    expect(scrubErrorReportText('/var/folders/73/f2h1abc_xyz/T/')).toBe('<tmp>/T/')
    expect(scrubErrorReportText('/tmp/ow-scratch-501/19fa3e03/bc0690b248f8/push.log')).toBe(
      '/tmp/<scratch>/push.log',
    )
    expect(
      scrubErrorReportText('/tmp/ow-scratch-501/19fa3e03/evidence/bc0690b248f8/shot.png'),
    ).toBe('/tmp/<scratch>/shot.png')
    expect(scrubErrorReportText('/tmp/ow-scratch-501/19fa3e03')).toBe('/tmp/<scratch>')
    expect(
      scrubErrorReportText(
        'C:\\Users\\SEANOB~1\\AppData\\Local\\Temp\\ow-scratch\\0a1b2c3d\\0a1b2c3d4e5f\\x.txt',
      ),
    ).toBe('~\\AppData\\Local\\Temp\\<scratch>\\x.txt')
  })

  it('replaces UUIDs and long hex runs after the paths', () => {
    expect(scrubErrorReportText('Session 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b is busy')).toBe(
      'Session <id> is busy',
    )
    expect(scrubErrorReportText('run 0123456789ABCDEF0123456789abcdef')).toBe('run <hex>')
    expect(scrubErrorReportText('short 0123456789abcde')).toBe('short 0123456789abcde')
    expect(scrubErrorReportPaths('Session 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
      'Session 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    )
  })
})

describe('known directories', () => {
  it('replace the exact home and temporary directories first', () => {
    const scrub = createErrorReportTextScrubber({
      homeDirectory: "C:\\Users\\Sean O'Brien",
      temporaryDirectory: "C:\\Users\\Sean O'Brien\\AppData\\Local\\Temp",
    })

    expect(
      scrub("C:\\Users\\Sean O'Brien\\AppData\\Local\\Temp\\x and c:/users/sean o'brien"),
    ).toBe('<tmp>\\x and ~')
    expect(
      createErrorReportTextScrubber({ homeDirectory: '/var/home/sam' })('at /var/home/sam/x'),
    ).toBe('at ~/x')
    expect(
      createErrorReportTextScrubber({ homeDirectory: 'D:\\Profiles\\sam' })('d:/profiles/SAM/a'),
    ).toBe('~/a')
  })

  it('never match the start of a longer folder name', () => {
    const scrub = createErrorReportTextScrubber({ homeDirectory: '/srv/sam' })

    expect(scrub('/srv/sam/x /srv/sam-data/y')).toBe('~/x /srv/sam-data/y')
    expect(createErrorReportTextScrubber({ homeDirectory: '/' })('/etc/hosts')).toBe('/etc/hosts')
  })

  it('keep identifiers in fields scrubbed for paths only', () => {
    const scrub = createErrorReportPathScrubber({ homeDirectory: '/srv/sam' })

    expect(scrub('/srv/sam/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.js')).toBe(
      '~/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.js',
    )
  })
})

describe('message text rule', () => {
  const handled = { mechanism: { type: 'generic', handled: true } }

  it('keeps message text only for a handled error the app reported as an application error', () => {
    const application = { [ERROR_REPORT_ORIGIN_TAG]: 'application' }

    expect(
      keepsErrorReportMessageText({ tags: application, exception: { values: [handled] } }),
    ).toBe(true)
    expect(keepsErrorReportMessageText({ exception: { values: [handled] } })).toBe(false)
    expect(
      keepsErrorReportMessageText({
        tags: { [ERROR_REPORT_ORIGIN_TAG]: 'tool-execution' },
        exception: { values: [handled] },
      }),
    ).toBe(false)
    expect(keepsErrorReportMessageText({ tags: application, message: 'no exception' })).toBe(false)
    expect(
      keepsErrorReportMessageText({
        tags: application,
        exception: { values: [handled, { mechanism: { handled: false } }] },
      }),
    ).toBe(false)
  })

  it('recognizes an error nothing handled', () => {
    expect(
      hasUnhandledErrorReportException({
        exception: { values: [handled, { mechanism: { handled: false } }] },
      }),
    ).toBe(true)
    expect(hasUnhandledErrorReportException({ exception: { values: [handled] } })).toBe(false)
  })

  it('finds the Node.js error code a message starts with', () => {
    expect(leadingNodeErrorCode("EACCES: permission denied, open '/x'")).toBe('EACCES')
    expect(leadingNodeErrorCode('ERR_STREAM_PREMATURE_CLOSE')).toBe('ERR_STREAM_PREMATURE_CLOSE')
    expect(leadingNodeErrorCode('Error: EACCES')).toBeUndefined()
    expect(leadingNodeErrorCode('EXTRAordinary')).toBeUndefined()
  })
})
