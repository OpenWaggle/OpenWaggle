import type { Rule } from 'eslint'
import { jsxIdentifierName, property } from '../ast-helpers'

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

function jsxAttributeCount(node: Rule.Node) {
  const attributes = property(node, 'attributes')
  return Array.isArray(attributes) ? attributes.length : 0
}

function jsxMaxPropsMaximum(options: readonly unknown[]) {
  const maximum = property(options[0], 'maximum')
  return typeof maximum === 'number' ? maximum : DEFAULT_JSX_MAX_PROPS
}

export const jsxMaxPropsRule: Rule.RuleModule = {
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
      JSXOpeningElement(node: Rule.Node) {
        const name = jsxIdentifierName(node)
        if (!name || /^[a-z]/.test(name) || JSX_MAX_PROPS_IGNORED_COMPONENTS.has(name)) {
          return
        }

        if (jsxAttributeCount(node) > maximum) {
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
