import type { ESTree, Rule } from '@oxlint/plugins'
import { sourceValueOf } from '../ast-helpers.ts'

const REACT_PACKAGE = 'react'
const LEGACY_NAMED_IMPORTS = new Set(['forwardRef', 'memo'])
const LEGACY_REACT_TYPES = new Set(['FC', 'FunctionComponent'])

function identifierName(node: ESTree.Node) {
  return node.type === 'Identifier' ? node.name : null
}

/** The name an import specifier imports: `default` and `*` imports name none. */
function importedNameOf(specifier: ESTree.ImportDeclarationSpecifier) {
  return specifier.type === 'ImportSpecifier' ? identifierName(specifier.imported) : null
}

/** `React.<name>` (or `React[name]`): the member name a call reads off `React`. */
function reactMemberName(callee: ESTree.Expression) {
  if (callee.type !== 'MemberExpression' || identifierName(callee.object) !== 'React') return null
  return identifierName(callee.property)
}

function typeReferenceName({ typeName }: ESTree.TSTypeReference) {
  const directName = identifierName(typeName)
  if (directName) {
    return directName
  }

  if (typeName.type === 'TSQualifiedName' && identifierName(typeName.left) === 'React') {
    return typeName.right.name
  }

  return null
}

export const noReactLegacyPatternsRule: Rule = {
  meta: {
    type: 'problem',
    messages: {
      noForwardRef:
        'Do not use forwardRef. React 19 supports direct ref props; model refs explicitly in props.',
      noMemo:
        'Do not use React.memo or memo. React Compiler handles render memoization in this project.',
      noReactFc:
        'Do not use React.FC or React.FunctionComponent. Define components as plain functions with explicit props.',
    },
  },
  create(context) {
    const legacyCallNames = new Map<string, 'noForwardRef' | 'noMemo'>()

    return {
      ImportDeclaration(node) {
        if (sourceValueOf(node) !== REACT_PACKAGE) {
          return
        }

        for (const specifier of node.specifiers) {
          const importedName = importedNameOf(specifier)
          if (!importedName || !LEGACY_NAMED_IMPORTS.has(importedName)) {
            continue
          }

          const messageId = importedName === 'forwardRef' ? 'noForwardRef' : 'noMemo'
          const localName = specifier.local.name
          legacyCallNames.set(localName, messageId)

          context.report({
            node: specifier,
            messageId,
          })
        }
      },
      CallExpression(node) {
        const { callee } = node
        const directName = identifierName(callee)
        const directMessageId = directName ? legacyCallNames.get(directName) : undefined

        if (directMessageId) {
          context.report({
            node,
            messageId: directMessageId,
          })
          return
        }

        const memberName = reactMemberName(callee)
        if (memberName === 'memo') {
          context.report({
            node,
            messageId: 'noMemo',
          })
        }

        if (memberName === 'forwardRef') {
          context.report({
            node,
            messageId: 'noForwardRef',
          })
        }
      },
      TSTypeReference(node) {
        const typeName = typeReferenceName(node)
        if (!typeName || !LEGACY_REACT_TYPES.has(typeName)) {
          return
        }

        context.report({
          node,
          messageId: 'noReactFc',
        })
      },
    }
  },
}
