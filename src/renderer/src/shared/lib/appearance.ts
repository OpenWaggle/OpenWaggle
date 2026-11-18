export type OpenWaggleStandardAppearanceName =
  | 'dark'
  | 'light'
  | 'high-contrast-dark'
  | 'high-contrast-light'
export type OpenWaggleAppearanceName = OpenWaggleStandardAppearanceName | 'debug'

export function isOpenWaggleStandardAppearanceName(
  value: string | null,
): value is OpenWaggleStandardAppearanceName {
  return (
    value === 'dark' ||
    value === 'light' ||
    value === 'high-contrast-dark' ||
    value === 'high-contrast-light'
  )
}

const APPEARANCE_DATA_ATTRIBUTE = 'data-theme'
const DEBUG_APPEARANCE_NAME = 'debug'
const DEBUG_APPEARANCE_TEST_FLAG = '__openwaggleAllowDebugAppearance'
const SET_APPEARANCE_TEST_HOOK = '__openwaggleSetAppearance'

/**
 * The debug Appearance is reachable only in dev builds or when an explicit test flag is
 * set on `window` (the e2e suite sets it before flipping). Production users never reach it.
 */
function isDebugAppearanceAllowed() {
  if (import.meta.env.DEV) {
    return true
  }

  if (typeof window === 'undefined') return false
  return Reflect.get(window, DEBUG_APPEARANCE_TEST_FLAG) === true
}

export function setAppearance(name: OpenWaggleAppearanceName) {
  if (name === DEBUG_APPEARANCE_NAME && !isDebugAppearanceAllowed()) {
    throw new Error('The debug appearance is only available in dev or test builds.')
  }

  document.documentElement.setAttribute(APPEARANCE_DATA_ATTRIBUTE, name)
}

function installTestHook() {
  if (typeof window === 'undefined') return
  Object.defineProperty(window, SET_APPEARANCE_TEST_HOOK, {
    configurable: true,
    value: setAppearance,
  })
}

installTestHook()
