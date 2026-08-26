import { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries } from './theme.js'
import type { OpenWaggleExtensionTheme } from './theme-types.js'
import {
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
} from './ui-constants.js'

export interface CreateOpenWaggleExtensionUiStylesheetOptions {
  readonly theme?: OpenWaggleExtensionTheme
  readonly scopeSelector?: string
  readonly includeThemeVariables?: boolean
}

const DEFAULT_UI_SCOPE_SELECTOR = `.${OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.root}`

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
  font-size: var(--ow-text-sm);
  line-height: var(--ow-text-sm--line-height);
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
  border-radius: var(--ow-radius-3xl);
  box-shadow: var(--ow-shadow-sm);
  padding: calc(var(--ow-spacing) * 4);
}

${selector} .${classes.stack} {
  display: flex;
  flex-direction: column;
  gap: calc(var(--ow-spacing) * 3);
}

${selector} .${classes.row} {
  align-items: center;
  display: flex;
  gap: calc(var(--ow-spacing) * 2);
}

${selector} .${classes.heading} {
  color: var(--ow-color-text);
  font-size: var(--ow-text-base);
  font-weight: 650;
  line-height: var(--ow-text-base--line-height);
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
  margin: calc(var(--ow-spacing) * 1) 0;
}`
}

function controlUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES
  const attributes = OPENWAGGLE_EXTENSION_UI_ATTRIBUTES

  return `${selector} .${classes.button} {
  align-items: center;
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border-strong);
  border-radius: var(--ow-radius-lg);
  color: var(--ow-color-text);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 600;
  gap: calc(var(--ow-spacing) * 2);
  justify-content: center;
  min-height: calc(var(--ow-spacing) * 8);
  padding: 0 calc(var(--ow-spacing) * 3);
}

${selector} .${classes.button}:disabled,
${selector} .${classes.input}:disabled,
${selector} .${classes.textarea}:disabled,
${selector} .${classes.select}:disabled,
${selector} .${classes.checkbox}:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

${selector} .${classes.button}:focus-visible,
${selector} .${classes.input}:focus-visible,
${selector} .${classes.textarea}:focus-visible,
${selector} .${classes.select}:focus-visible,
${selector} .${classes.checkbox}:focus-visible {
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

${selector} .${classes.input},
${selector} .${classes.textarea},
${selector} .${classes.select} {
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border-strong);
  border-radius: var(--ow-radius-lg);
  color: var(--ow-color-text);
  font: inherit;
  min-height: calc(var(--ow-spacing) * 8);
  padding: 0 calc(var(--ow-spacing) * 3);
}

${selector} .${classes.textarea} {
  min-height: calc(var(--ow-spacing) * 22);
  padding-bottom: calc(var(--ow-spacing) * 2);
  padding-top: calc(var(--ow-spacing) * 2);
  resize: vertical;
}

${selector} .${classes.input}::placeholder,
${selector} .${classes.textarea}::placeholder {
  color: var(--ow-color-text-dim);
}

${selector} .${classes.checkbox} {
  accent-color: var(--ow-color-accent);
  min-height: calc(var(--ow-spacing) * 4);
  min-width: calc(var(--ow-spacing) * 4);
}`
}

function badgeUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES
  const attributes = OPENWAGGLE_EXTENSION_UI_ATTRIBUTES

  return `${selector} .${classes.badge},
${selector} .${classes.alert} {
  align-items: center;
  background: var(--ow-color-surface-raised);
  border: 1px solid var(--ow-color-border);
  border-radius: var(--ow-radius-md);
  color: var(--ow-color-text-muted);
  display: inline-flex;
  font-size: var(--ow-text-xs);
  font-weight: 600;
  gap: calc(var(--ow-spacing) * 1);
  line-height: var(--ow-text-xs--line-height);
  padding: calc(var(--ow-spacing) * 1) calc(var(--ow-spacing) * 2);
}

${selector} .${classes.alert} {
  align-items: flex-start;
  border-radius: var(--ow-radius-lg);
  line-height: var(--ow-text-xs--line-height);
  padding: calc(var(--ow-spacing) * 3);
}

${selector} .${classes.badge}[${attributes.tone}="accent"],
${selector} .${classes.alert}[${attributes.tone}="accent"] {
  border-color: var(--ow-color-accent-dim);
  color: var(--ow-color-accent);
}

${selector} .${classes.badge}[${attributes.tone}="success"],
${selector} .${classes.alert}[${attributes.tone}="success"] {
  color: var(--ow-color-success);
}

${selector} .${classes.badge}[${attributes.tone}="warning"],
${selector} .${classes.alert}[${attributes.tone}="warning"] {
  color: var(--ow-color-warning);
}

${selector} .${classes.badge}[${attributes.tone}="danger"],
${selector} .${classes.alert}[${attributes.tone}="danger"] {
  color: var(--ow-color-danger-text);
}

${selector} .${classes.badge}[${attributes.tone}="info"],
${selector} .${classes.alert}[${attributes.tone}="info"] {
  color: var(--ow-color-info-text);
}`
}

function formUiRules(selector: string) {
  const classes = OPENWAGGLE_EXTENSION_UI_CLASS_NAMES

  return `${selector} .${classes.field} {
  display: flex;
  flex-direction: column;
  gap: calc(var(--ow-spacing) * 1);
}`
}

function extensionUiRules(selector: string) {
  return `${baseUiRules(selector)}

${controlUiRules(selector)}

${badgeUiRules(selector)}

${formUiRules(selector)}`
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
