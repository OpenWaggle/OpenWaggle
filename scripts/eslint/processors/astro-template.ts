import type { Linter } from 'eslint'
import { normalizedFilename } from '../ast-helpers'

const RAW_BUTTON_PATTERN = /<button\b/g
const ALLOWED_RAW_ASTRO_BUTTON_FILES = new Set(['website/src/components/ui/Button.astro'])
const GENERATED_EMPTY_MODULE = 'export {}\n'
const RAW_ASTRO_BUTTON_RULE_ID = 'openwaggle/no-raw-astro-buttons'
const ERROR_SEVERITY = 2

const rawAstroButtonMessagesByFilename = new Map<string, Linter.LintMessage[]>()

function canUseRawAstroButton(filename: string) {
  const normalized = normalizedFilename(filename)

  for (const allowedFile of ALLOWED_RAW_ASTRO_BUTTON_FILES) {
    if (normalized.endsWith(allowedFile)) {
      return true
    }
  }

  return false
}

function lineColumnForIndex(text: string, index: number) {
  let line = 1
  let column = 1

  for (const character of text.slice(0, index)) {
    if (character === '\n') {
      line++
      column = 1
      continue
    }

    column++
  }

  return { line, column }
}

function collectRawAstroButtonMessages(text: string, filename: string) {
  const messages: Linter.LintMessage[] = []

  if (canUseRawAstroButton(filename)) {
    return messages
  }

  for (const match of text.matchAll(RAW_BUTTON_PATTERN)) {
    const index = match.index
    const { line, column } = lineColumnForIndex(text, index)
    messages.push({
      column,
      line,
      endColumn: column + match[0].length,
      endLine: line,
      ruleId: RAW_ASTRO_BUTTON_RULE_ID,
      message: 'Use the shared website Button primitive instead of raw <button> in Astro files.',
      severity: ERROR_SEVERITY,
    })
  }

  return messages
}

export const astroTemplateProcessor: Linter.Processor = {
  meta: {
    name: 'astro-template',
  },
  supportsAutofix: false,
  preprocess(text: string, filename: string) {
    rawAstroButtonMessagesByFilename.set(filename, collectRawAstroButtonMessages(text, filename))
    return [GENERATED_EMPTY_MODULE]
  },
  postprocess(messageLists: Linter.LintMessage[][], filename: string) {
    const messages = rawAstroButtonMessagesByFilename.get(filename) ?? []
    rawAstroButtonMessagesByFilename.delete(filename)

    return [...messageLists.flat(), ...messages]
  },
}
