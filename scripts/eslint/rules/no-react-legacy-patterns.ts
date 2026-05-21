import type { Rule } from 'eslint'
import { isLintNode, isUnknownArray, property, sourceValueOf } from '../ast-helpers'

const REACT_PACKAGE = 'react'
const LEGACY_NAMED_IMPORTS = new Set(['forwardRef', 'memo'])
const LEGACY_REACT_TYPES = new Set(['FC', 'FunctionComponent'])

function nameOf(value: unknown) {
  const name = property(value, 'name')
  return typeof name === 'string' ? name : null
}

function importedNameOf(value: unknown) {
  const imported = property(value, 'imported')
  const importedName = nameOf(imported)
  if (importedName) {
    return importedName
  }

  return typeof imported === 'string' ? imported : null
}

function localNameOf(value: unknown) {
  return nameOf(property(value, 'local'))
}

function memberPropertyName(value: unknown) {
  return nameOf(property(value, 'property'))
}

function memberObjectName(value: unknown) {
  return nameOf(property(value, 'object'))
}

function typeReferenceName(value: unknown) {
  const typeName = property(value, 'typeName')
  const directName = nameOf(typeName)
  if (directName) {
    return directName
  }

  const leftName = nameOf(property(typeName, 'left'))
  const rightName = nameOf(property(typeName, 'right'))

  if (leftName === 'React' && rightName) {
    return rightName
  }

  return null
}

export const noReactLegacyPatternsRule: Rule.RuleModule = {
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
      ImportDeclaration(node: Rule.Node) {
        if (sourceValueOf(node) !== REACT_PACKAGE) {
          return
        }

        const specifiers = property(node, 'specifiers')
        if (!isUnknownArray(specifiers)) {
          return
        }

        for (const specifierValue of specifiers) {
          if (!isLintNode(specifierValue)) {
            continue
          }

          const specifier = specifierValue
          const importedName = importedNameOf(specifier)
          if (!importedName || !LEGACY_NAMED_IMPORTS.has(importedName)) {
            continue
          }

          const messageId = importedName === 'forwardRef' ? 'noForwardRef' : 'noMemo'
          const localName = localNameOf(specifier) ?? importedName
          legacyCallNames.set(localName, messageId)

          context.report({
            node: specifier,
            messageId,
          })
        }
      },
      CallExpression(node: Rule.Node) {
        const callee = property(node, 'callee')
        const directName = nameOf(callee)
        const directMessageId = directName ? legacyCallNames.get(directName) : undefined

        if (directMessageId) {
          context.report({
            node,
            messageId: directMessageId,
          })
          return
        }

        if (memberObjectName(callee) === 'React' && memberPropertyName(callee) === 'memo') {
          context.report({
            node,
            messageId: 'noMemo',
          })
        }

        if (memberObjectName(callee) === 'React' && memberPropertyName(callee) === 'forwardRef') {
          context.report({
            node,
            messageId: 'noForwardRef',
          })
        }
      },
      TSTypeReference(node: Rule.Node) {
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
