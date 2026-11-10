import type { Node, Rule } from '@oxlint/plugins'
import { jsxIdentifierName, normalizedFilename } from '../ast-helpers.ts'

const RAW_BUTTON_ALLOWED_FILES = new Set([
  'src/renderer/src/shared/ui/Button.tsx',
  'src/renderer/src/shared/ui/ToggleSwitch.tsx',
])

function isRawButtonAllowed(filename: string) {
  const normalized = normalizedFilename(filename)

  for (const allowedFile of RAW_BUTTON_ALLOWED_FILES) {
    if (normalized.endsWith(allowedFile)) {
      return true
    }
  }

  return false
}

export const noRawRendererButtonsRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      useSharedButton: 'Use the shared Button primitive instead of raw <button> in renderer UI.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node: Node) {
        if (jsxIdentifierName(node) !== 'button' || isRawButtonAllowed(context.filename)) {
          return
        }

        context.report({
          node,
          messageId: 'useSharedButton',
        })
      },
    }
  },
}
