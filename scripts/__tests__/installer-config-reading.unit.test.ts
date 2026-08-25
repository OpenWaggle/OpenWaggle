import { describe, expect, it } from 'vitest'
import { resolveInstallerScriptFrom } from '../check-installer-script'

describe('resolveInstallerScriptFrom', () => {
  it('reads the include from the nsis block', () => {
    expect(resolveInstallerScriptFrom('nsis:\n  include: build/installer.nsh\n')).toBe(
      'build/installer.nsh',
    )
  })

  it('accepts a quoted value, a comment, and a wider indent', () => {
    /*
     * The first version was a two-space-only, comment-unaware, quote-unaware scanner: a quoted value came
     * back with its quotes, so the path did not exist and the check crashed with a raw ENOENT, and four
     * other valid YAML spellings returned null - which reached a message telling the maintainer to delete
     * the check.
     */
    const config = ['nsis:  # windows installer', '    include: "build/installer.nsh"  # quoted'].join(
      '\n',
    )

    expect(resolveInstallerScriptFrom(config)).toBe('build/installer.nsh')
  })

  it('ignores an include belonging to another block', () => {
    const config = ['dmg:', '  include: build/not-the-installer.nsh', 'nsis:', '  oneClick: false'].join(
      '\n',
    )

    expect(resolveInstallerScriptFrom(config)).toBeNull()
  })

  it('reports a list value rather than compiling one entry of it', () => {
    expect(resolveInstallerScriptFrom('nsis:\n  include:\n    - build/a.nsh\n')).toBeNull()
  })

  it('reads a CRLF config', () => {
    // A `\r` left on the value produced a path that does not exist, and the check died with a raw ENOENT.
    expect(resolveInstallerScriptFrom('nsis:\r\n  include: build/installer.nsh\r\n')).toBe(
      'build/installer.nsh',
    )
  })
})
