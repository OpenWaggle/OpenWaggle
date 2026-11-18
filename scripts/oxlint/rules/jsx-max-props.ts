import type { Rule } from '@oxlint/plugins'
import { jsxIdentifierName } from '../ast-helpers.ts'

const DEFAULT_JSX_MAX_PROPS = 8
const JSX_MAX_PROPS_IGNORED_COMPONENTS = new Set([
  'Button',
  'Checkbox',
  'RangeInput',
  'Select',
  'Textarea',
  'TextInput',
  'ToggleSwitch',
])

function jsxMaxPropsMaximum(options: readonly unknown[]) {
  const [option] = options
  const maximum =
    typeof option === 'object' && option !== null && 'maximum' in option
      ? option.maximum
      : undefined
  return typeof maximum === 'number' ? maximum : DEFAULT_JSX_MAX_PROPS
}

export const jsxMaxPropsRule: Rule = {
  meta: {
    type: 'suggestion',
    schema: [
      {
        type: 'object',
        properties: {
          maximum: {
            type: 'number',
            minimum: 1,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyProps:
        'JSX elements should receive at most {{maximum}} props. Prefer focused state subscriptions or smaller composition boundaries.',
    },
  },
  create(context) {
    const maximum = jsxMaxPropsMaximum(context.options)

    return {
      JSXOpeningElement(node) {
        const name = jsxIdentifierName(node)
        if (!name || /^[a-z]/.test(name) || JSX_MAX_PROPS_IGNORED_COMPONENTS.has(name)) {
          return
        }

        if (node.attributes.length > maximum) {
          context.report({
            node,
            messageId: 'tooManyProps',
            data: {
              maximum,
            },
          })
        }
      },
    }
  },
}
