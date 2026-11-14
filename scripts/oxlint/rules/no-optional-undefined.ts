import type { Context, ESTree, Rule } from '@oxlint/plugins'

const MARKER = /explicit undefined/iu

type OptionalProperty = ESTree.TSPropertySignature | ESTree.PropertyDefinition
type Comment = ReturnType<Context['sourceCode']['getAllComments']>[number]

/** Whether a comment containing the marker sits right before `start`, with only space between. */
function markedBefore(text: string, comments: readonly Comment[], start: number) {
  let end = start
  for (const comment of comments.toReversed()) {
    if (comment.range[1] > end) continue
    if (text.slice(comment.range[1], end).trim() !== '') return false
    if (MARKER.test(comment.value)) return true
    end = comment.range[0]
  }
  return false
}

/** The property and the type declaration around it, where a marker comment may stand. */
function markerAnchors(node: OptionalProperty) {
  const anchors: number[] = [node.range[0]]
  let current: ESTree.Node | null = node.parent
  while (current !== null) {
    if (current.type === 'TSInterfaceDeclaration' || current.type === 'TSTypeAliasDeclaration') {
      anchors.push(current.range[0])
      if (current.parent.type === 'ExportNamedDeclaration') anchors.push(current.parent.range[0])
      break
    }
    current = current.parent
  }
  return anchors
}

/** The source range that drops `undefined` and one `|` next to it from the union. */
function removalRange(text: string, union: ESTree.TSUnionType, index: number) {
  const member = union.types[index]
  const previous = union.types[index - 1]
  if (member === undefined) {
    const result: [number, number] = [0, 0]
    return result
  }
  if (previous !== undefined) {
    const between = text.slice(previous.range[1], member.range[0])
    const bar = previous.range[1] + between.lastIndexOf('|')
    const start = previous.range[1] + between.slice(0, bar - previous.range[1]).trimEnd().length
    const result: [number, number] = [start, member.range[1]]
    return result
  }
  const next = union.types[index + 1]
  const result: [number, number] = [
    member.range[0],
    next === undefined ? member.range[1] : next.range[0],
  ]
  return result
}

/**
 * An optional property says its key may be missing; `?: T | undefined` also lets the key be set
 * to undefined, which `exactOptionalPropertyTypes` exists to tell apart. A caller with no value
 * leaves the key out: `...(x === undefined ? {} : { x })`. Where the data really carries an
 * explicit undefined (a third-party type declares it, or a runtime source sets it), a comment
 * containing `explicit undefined` on the property or its type declaration says why. Types
 * inferred from a schema are not hand-written and pass; write the schema field as
 * `Schema.optionalWith(X, { exact: true })`. The fix drops `| undefined`.
 */
export const noOptionalUndefinedRule: Rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    messages: {
      optionalUndefined:
        "Optional property '{{name}}' also allows an explicit undefined. Drop '| undefined' and have callers omit the key, or say why the data carries an explicit undefined in a comment containing 'explicit undefined'.",
    },
  },
  create(context) {
    const check = (node: OptionalProperty) => {
      if (!node.optional) return
      const union = node.typeAnnotation?.typeAnnotation
      if (union?.type !== 'TSUnionType') return
      const index = union.types.findIndex((member) => member.type === 'TSUndefinedKeyword')
      if (index === -1) return
      const text = context.sourceCode.text
      const comments = context.sourceCode.getAllComments()
      if (markerAnchors(node).some((anchor) => markedBefore(text, comments, anchor))) return
      context.report({
        node,
        messageId: 'optionalUndefined',
        data: { name: text.slice(node.key.range[0], node.key.range[1]) },
        fix: (fixer) => fixer.removeRange(removalRange(text, union, index)),
      })
    }
    return { TSPropertySignature: check, PropertyDefinition: check }
  },
}
