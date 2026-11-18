import { describe, expect, it } from 'vitest'

import config from '../../electron-builder'

/**
 * The installer check compiles the exact `nsis.include` script electron-builder
 * will use. Since the config moved to a `.ts` module (docs/adr/0032), assert the
 * single include path is readable straight from it rather than text-parsing YAML.
 */
describe('electron-builder nsis.include', () => {
  it('declares exactly one installer script path', () => {
    const include = config.nsis.include
    expect(typeof include).toBe('string')
    expect(include).toBe('build/installer.nsh')
  })
})
