import type { Node, Plugin, Rule } from '@oxlint/plugins'
import { nodeType, property } from './ast-helpers.ts'

const preferMatchOverSwitchRule: Rule = {
  meta: {
    type: 'suggestion',
    messages: {
      preferMatch:
        'Switch statements are disallowed; use match/matchBy from @diegogbrisa/ts-match.',
    },
  },
  create(context) {
    return {
      SwitchStatement(node: Node) {
        context.report({
          node,
          messageId: 'preferMatch',
        })
      },
    }
  },
}

const preferMatchOverElseIfRule: Rule = {
  meta: {
    type: 'suggestion',
    messages: {
      preferMatch:
        'Else-if chains are disallowed; use match/matchBy from @diegogbrisa/ts-match or guard clauses.',
    },
  },
  create(context) {
    return {
      IfStatement(node: Node) {
        const alternate = property(node, 'alternate')
        if (nodeType(alternate) !== 'IfStatement') {
          return
        }

        context.report({
          node,
          messageId: 'preferMatch',
        })
      },
    }
  },
}

export const tsMatchPlugin: Plugin = {
  meta: {
    name: 'ts-match',
  },
  rules: {
    'prefer-match-over-switch': preferMatchOverSwitchRule,
    'prefer-match-over-else-if': preferMatchOverElseIfRule,
  },
}

export default tsMatchPlugin
