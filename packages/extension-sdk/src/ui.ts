export type {
  OpenWaggleExtensionUiButtonVariant,
  OpenWaggleExtensionUiTone,
} from './ui-constants.js'
export {
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
} from './ui-constants.js'

export type OpenWaggleExtensionClassNamePart = string | false | null | undefined

const EMPTY_LENGTH = 0

export function openWaggleExtensionClassName(
  ...parts: readonly OpenWaggleExtensionClassNamePart[]
): string {
  const classNames: string[] = []

  for (const part of parts) {
    if (typeof part !== 'string') {
      continue
    }

    const className = part.trim()
    if (className.length > EMPTY_LENGTH) {
      classNames.push(className)
    }
  }

  return classNames.join(' ')
}

export type { CreateOpenWaggleExtensionUiStylesheetOptions } from './ui-stylesheet.js'
export {
  createOpenWaggleExtensionUiStylesheet,
  extensionThemeCssVariableDeclarations,
} from './ui-stylesheet.js'
