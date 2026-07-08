export const OPENWAGGLE_EXTENSION_UI_CLASS_NAMES = {
  root: 'ow-extension-root',
  panel: 'ow-extension-panel',
  stack: 'ow-extension-stack',
  row: 'ow-extension-row',
  heading: 'ow-extension-heading',
  text: 'ow-extension-text',
  muted: 'ow-extension-muted',
  divider: 'ow-extension-divider',
  button: 'ow-extension-button',
  input: 'ow-extension-input',
  textarea: 'ow-extension-textarea',
  select: 'ow-extension-select',
  checkbox: 'ow-extension-checkbox',
  badge: 'ow-extension-badge',
  field: 'ow-extension-field',
  alert: 'ow-extension-alert',
} as const

export const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES = {
  tone: 'data-ow-tone',
  variant: 'data-ow-variant',
} as const

export type OpenWaggleExtensionUiTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export type OpenWaggleExtensionUiButtonVariant = 'primary' | 'secondary' | 'ghost'
