import type { ESTree, Rule } from '@oxlint/plugins'

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/u

/** The key a computed member names with a string literal, when it is a valid identifier. */
function literalIdentifierKey(key: ESTree.Expression | ESTree.PrivateIdentifier) {
  if (key.type === 'Literal' && typeof key.value === 'string') {
    return IDENTIFIER_NAME.test(key.value) ? key.value : null
  }
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0) {
    const text = key.quasis.at(0)?.value.cooked
    return typeof text === 'string' && IDENTIFIER_NAME.test(text) ? text : null
  }
  return null
}

/**
 * A fixed key is read with dot access: `x.name`, never `x['name']`. Outside data is decoded at
 * the boundary with a schema from src/shared/schema into a declared type [TS-06], so its fields are
 * declared properties; a map keyed by a runtime value is read with a variable key. A key that is
 * not a valid identifier (`headers['content-type']`) and type-level indexed access
 * (`Message['parts']`) pass. The fix rewrites `x['name']` to `x.name` and `x?.['name']` to
 * `x?.name`. There is no exceptions list.
 */
export const noLiteralKeyLookupRule: Rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    messages: {
      literalKey:
        "Read '{{key}}' with dot access. Decode outside data with a schema from src/shared/schema where it enters [TS-06]; a map keyed by a runtime value uses a variable key.",
    },
  },
  create(context) {
    return {
      MemberExpression(node: ESTree.MemberExpression) {
        if (!node.computed) return
        const key = literalIdentifierKey(node.property)
        if (key === null) return
        const between = context.sourceCode.text.slice(node.object.range[1], node.property.range[0])
        const bracket = node.object.range[1] + between.lastIndexOf('[')
        context.report({
          node,
          messageId: 'literalKey',
          data: { key },
          fix: (fixer) =>
            fixer.replaceTextRange([bracket, node.range[1]], node.optional ? key : `.${key}`),
        })
      },
    }
  },
}
