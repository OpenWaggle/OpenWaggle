import type { ESLint, Rule } from 'eslint'
import { nodeType, property } from './ast-helpers'

const preferMatchOverSwitchRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    messages: {
      preferMatch:
        'Switch statements are disallowed; use match/matchBy from @diegogbrisa/ts-match.',
    },
  },
  create(context) {
    return {
      SwitchStatement(node: Rule.Node) {
        context.report({
          node,
          messageId: 'preferMatch',
        })
      },
    }
  },
}

const preferMatchOverElseIfRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    messages: {
      preferMatch:
        'Else-if chains are disallowed; use match/matchBy from @diegogbrisa/ts-match or guard clauses.',
    },
  },
  create(context) {
    return {
      IfStatement(node: Rule.Node) {
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

export const tsMatchPlugin: ESLint.Plugin = {
  meta: {
    name: 'ts-match',
  },
  rules: {
    'prefer-match-over-switch': preferMatchOverSwitchRule,
    'prefer-match-over-else-if': preferMatchOverElseIfRule,
  },
}
