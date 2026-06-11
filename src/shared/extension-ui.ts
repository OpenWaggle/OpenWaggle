import { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries } from './extension-theme'
import type { OpenWaggleExtensionTheme } from './extension-theme-types'

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
  badge: 'ow-extension-badge',
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

export type OpenWaggleExtensionClassNamePart = string | false | null | undefined

export interface CreateOpenWaggleExtensionUiStylesheetOptions {
  readonly theme?: OpenWaggleExtensionTheme
  readonly scopeSelector?: string
  readonly includeThemeVariables?: boolean
}

const DEFAULT_UI_SCOPE_SELECTOR = `.${OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.root}`
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

export function extensionThemeCssVariableDeclarations(
  theme: OpenWaggleExtensionTheme = createOpenWaggleExtensionTheme(),
): string {
  const declarations: string[] = []

  for (const entry of extensionThemeCssVariableEntries(theme)) {
    declarations.push(`  ${entry.name}: ${entry.value};`)
  }

  return declarations.join('\n')
}

function themeVariableRule(theme: OpenWaggleExtensionTheme, selector: string) {
  return `${selector} {
${extensionThemeCssVariableDeclarations(theme)}
}`
}

function baseUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES

  return `${selector} {
  color: var(--ow-color-text);
  font-family: var(--ow-font-family-sans);
  font-size: 13px;
  line-height: 1.45;
  box-sizing: border-box;
}

${selector} *,
${selector} *::before,
${selector} *::after {
  box-sizing: inherit;
}

${selector} .${classes.panel} {
  background: var(--ow-color-surface);
  border: 1px solid var(--ow-color-border);
  border-radius: var(--ow-radius-panel);
  box-shadow: var(--ow-elevation-card);
  padding: var(--ow-space-lg);
}

${selector} .${classes.stack} {
  display: flex;
  flex-direction: column;
  gap: var(--ow-space-md);
}

${selector} .${classes.row} {
  align-items: center;
  display: flex;
  gap: var(--ow-space-sm);
}

${selector} .${classes.heading} {
  color: var(--ow-color-text);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.25;
  margin: 0;
}

${selector} .${classes.text} {
  color: var(--ow-color-text-subtle);
  margin: 0;
}

${selector} .${classes.muted} {
  color: var(--ow-color-text-muted);
}

${selector} .${classes.divider} {
  background: var(--ow-color-border);
  border: 0;
  height: 1px;
  margin: var(--ow-space-xs) 0;
}`
}

function controlUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES
  const attributes = OPENWAGGLE_EXTENSION_UI_ATTRIBUTES

  return `${selector} .${classes.button} {
  align-items: center;
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border-strong);
  border-radius: var(--ow-radius-md);
  color: var(--ow-color-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 600;
  gap: var(--ow-space-sm);
  justify-content: center;
  min-height: 32px;
  padding: 0 var(--ow-space-md);
}

${selector} .${classes.button}:focus-visible,
${selector} .${classes.input}:focus-visible {
  box-shadow: var(--ow-focus-shadow);
  outline: 1px solid var(--ow-focus-ring);
}

${selector} .${classes.button}[${attributes.variant}="primary"] {
  background: var(--ow-color-accent);
  border-color: var(--ow-color-accent);
  color: var(--ow-color-background);
}

${selector} .${classes.button}[${attributes.variant}="ghost"] {
  background: transparent;
  border-color: transparent;
}

${selector} .${classes.input} {
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border-strong);
  border-radius: var(--ow-radius-md);
  color: var(--ow-color-text);
  font: inherit;
  min-height: 32px;
  padding: 0 var(--ow-space-md);
}

${selector} .${classes.input}::placeholder {
  color: var(--ow-color-text-dim);
}`
}

function badgeUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES
  const attributes = OPENWAGGLE_EXTENSION_UI_ATTRIBUTES

  return `${selector} .${classes.badge} {
  align-items: center;
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border);
  border-radius: var(--ow-radius-sm);
  color: var(--ow-color-text-muted);
  display: inline-flex;
  font-size: 12px;
  font-weight: 600;
  gap: var(--ow-space-xs);
  line-height: 1;
  padding: var(--ow-space-xs) var(--ow-space-sm);
}

${selector} .${classes.badge}[${attributes.tone}="accent"] {
  border-color: var(--ow-color-accent-dim);
  color: var(--ow-color-accent);
}

${selector} .${classes.badge}[${attributes.tone}="success"] {
  color: var(--ow-color-success);
}

${selector} .${classes.badge}[${attributes.tone}="warning"] {
  color: var(--ow-color-warning);
}

${selector} .${classes.badge}[${attributes.tone}="danger"] {
  color: var(--ow-color-danger);
}

${selector} .${classes.badge}[${attributes.tone}="info"] {
  color: var(--ow-color-info);
}`
}

function extensionUiRules(selector: string) {
  return `${baseUiRules(selector)}

${controlUiRules(selector)}

${badgeUiRules(selector)}`
}

export function createOpenWaggleExtensionUiStylesheet(
  options: CreateOpenWaggleExtensionUiStylesheetOptions = {},
): string {
  const theme = options.theme ?? createOpenWaggleExtensionTheme()
  const selector = options.scopeSelector ?? DEFAULT_UI_SCOPE_SELECTOR
  const rules = extensionUiRules(selector)

  if (options.includeThemeVariables === false) {
    return rules
  }

  return `${themeVariableRule(theme, selector)}

${rules}`
}
