// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { setAppearance } from '../appearance'

const DEBUG_APPEARANCE_TEST_FLAG = '__openwaggleAllowDebugAppearance'
const SET_APPEARANCE_TEST_HOOK = '__openwaggleSetAppearance'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  Reflect.deleteProperty(window, DEBUG_APPEARANCE_TEST_FLAG)
})

describe('setAppearance', () => {
  it('sets the theme attribute for a real appearance', () => {
    setAppearance('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('reaches the debug appearance when the test flag is set', () => {
    Reflect.set(window, DEBUG_APPEARANCE_TEST_FLAG, true)

    setAppearance('debug')

    expect(document.documentElement.getAttribute('data-theme')).toBe('debug')
  })

  it('installs the test hook on window for e2e', () => {
    const hook = Reflect.get(window, SET_APPEARANCE_TEST_HOOK)

    expect(hook).toBeTypeOf('function')

    Reflect.get(window, SET_APPEARANCE_TEST_HOOK)?.('dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
