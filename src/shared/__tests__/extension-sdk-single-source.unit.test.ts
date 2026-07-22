import {
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES as CANONICAL_UI_CLASS_NAMES,
  createExtensionBrokerSdk as createCanonicalExtensionBrokerSdk,
  createOpenWaggleExtensionTheme as createCanonicalOpenWaggleExtensionTheme,
} from '@openwaggle/extension-sdk'
import {
  createExtensionBrokerSdk,
  createOpenWaggleExtensionTheme,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
} from '@shared/extension-sdk'
import { describe, expect, it } from 'vitest'

describe('app extension SDK wrapper', () => {
  it('uses @openwaggle/extension-sdk as the source for duplicated public SDK helpers', () => {
    expect(createExtensionBrokerSdk).toBe(createCanonicalExtensionBrokerSdk)
    expect(createOpenWaggleExtensionTheme).toBe(createCanonicalOpenWaggleExtensionTheme)
    expect(OPENWAGGLE_EXTENSION_UI_CLASS_NAMES).toBe(CANONICAL_UI_CLASS_NAMES)
  })
})
