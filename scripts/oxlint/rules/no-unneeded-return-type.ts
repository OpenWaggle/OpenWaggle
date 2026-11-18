import type { ESTree, Rule } from '@oxlint/plugins'

/**
 * Reports an explicit return type on a function with a body: TypeScript infers it. A function
 * keeps one only where the annotation says something inference cannot:
 *
 * - a type predicate (`x is T`) or an assertion signature (`asserts x`, `asserts x is T`);
 * - an overload implementation, whose signature the overloads already state;
 * - a recursive function, directly or through other functions of the same file, which
 *   TypeScript cannot infer through its own call;
 * - a signature with no body (abstract, interface, overload or `declare`), which no visitor here
 *   reaches.
 *
 * The fix removes the annotation. Where that breaks type checking, the returned value is what to
 * type (`satisfies`, a typed constant, a decoded value), not the function.
 */

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression

function nameOf(node: ESTree.Node | null | undefined) {
  return node?.type === 'Identifier' || node?.type === 'PrivateIdentifier' ? node.name : null
}

/** The name a class member or object property goes by, or null for a computed key. */
function memberName(member: ESTree.Node) {
  if (
    member.type !== 'MethodDefinition' &&
    member.type !== 'PropertyDefinition' &&
    member.type !== 'Property'
  ) {
    return null
  }
  return member.computed ? null : nameOf(member.key)
}

/** The statements or class members a node sits among. */
function siblingsOf(node: ESTree.Node) {
  const { parent } = node
  const siblings: readonly ESTree.Node[] =
    parent?.type === 'Program' ||
    parent?.type === 'BlockStatement' ||
    parent?.type === 'TSModuleBlock' ||
    parent?.type === 'ClassBody'
      ? parent.body
      : []
  return siblings
}

/** The function an overload signature declares, seen through `export` and `export default`. */
function declaredFunctionName(statement: ESTree.Node) {
  const declaration =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
      ? statement.declaration
      : statement
  return declaration?.type === 'TSDeclareFunction' ? nameOf(declaration.id) : null
}

function isOverloadedFunctionDeclaration(node: ESTree.Function) {
  const name = nameOf(node.id)
  if (name === null) return false
  const { parent } = node
  const statement =
    parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration'
      ? parent
      : node
  return siblingsOf(statement).some(
    (sibling) => sibling !== statement && declaredFunctionName(sibling) === name,
  )
}

function isOverloadedMethod(method: ESTree.MethodDefinition) {
  const name = memberName(method)
  if (name === null) return false
  return siblingsOf(method).some(
    (sibling) =>
      sibling !== method &&
      sibling.type === 'MethodDefinition' &&
      memberName(sibling) === name &&
      sibling.static === method.static &&
      sibling.value.type === 'TSEmptyBodyFunctionExpression',
  )
}

function isOverloadImplementation(node: FunctionNode) {
  if (node.type === 'FunctionDeclaration') return isOverloadedFunctionDeclaration(node)
  const { parent } = node
  return parent.type === 'MethodDefinition' && isOverloadedMethod(parent)
}

function isInsideDeclare(node: FunctionNode) {
  let current: ESTree.Node | null = node.parent
  while (current) {
    if ('declare' in current && current.declare) return true
    current = current.type === 'Program' ? null : current.parent
  }
  return false
}

/**
 * The name a function's callers use: its own name, the variable it initialises, or `this.name`
 * for a method or a property of an object or class.
 */
function referenceKeyOf(node: FunctionNode) {
  const ownName = nameOf(node.id)
  if (ownName !== null) return ownName
  const { parent } = node
  if (parent.type === 'VariableDeclarator' && parent.init === node) return nameOf(parent.id)
  if (
    parent.type === 'MethodDefinition' ||
    parent.type === 'PropertyDefinition' ||
    (parent.type === 'Property' && parent.value === node)
  ) {
    const name = memberName(parent)
    return name === null ? null : `this.${name}`
  }
  return null
}

/** A function the walk is inside, and the names its body refers to. */
interface FunctionFrame {
  readonly node: FunctionNode
  readonly key: string | null
  readonly references: Set<string>
}

interface Candidate {
  readonly frame: FunctionFrame
  readonly returnType: ESTree.TSTypeAnnotation
}

/** A member name (`a.name`, `{ name: 1 }`, a class member) names no binding of this file. */
function isBindingReference(node: ESTree.Node) {
  const parent: ESTree.Node | null = node.parent
  if (!parent) return true
  if (parent.type === 'MemberExpression') return parent.computed || parent.property !== node
  if (parent.type === 'Property') return parent.computed || parent.shorthand || parent.key !== node
  if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') {
    return parent.computed || parent.key !== node
  }
  return true
}

function isWithin(node: ESTree.Node, container: ESTree.Node) {
  return node.range[0] >= container.range[0] && node.range[1] <= container.range[1]
}

/** Calls itself, directly or through other functions of the same file. */
function isRecursive(frame: FunctionFrame, graph: ReadonlyMap<string, ReadonlySet<string>>) {
  if (frame.key === null) return false
  const pending = [...frame.references]
  const seen = new Set<string>()
  while (true) {
    const next = pending.pop()
    if (next === undefined) return false
    if (next === frame.key) return true
    if (seen.has(next)) continue
    seen.add(next)
    pending.push(...(graph.get(next) ?? []))
  }
}

export const noUnneededReturnTypeRule: Rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    messages: {
      unneededReturnType:
        'Remove the return type: TypeScript infers it. Keep one only on a type predicate, an assertion signature, an overload implementation or a recursive function; where removing it breaks a caller, type the returned value instead.',
    },
  },
  create(context) {
    const stack: FunctionFrame[] = []
    const graph = new Map<string, Set<string>>()
    const candidates: Candidate[] = []

    function enter(node: FunctionNode) {
      const frame: FunctionFrame = { node, key: referenceKeyOf(node), references: new Set() }
      stack.push(frame)
      const { returnType, body } = node
      if (!returnType || !body) return
      if (returnType.typeAnnotation.type === 'TSTypePredicate') return
      if (isOverloadImplementation(node) || isInsideDeclare(node)) return
      candidates.push({ frame, returnType })
    }

    function exit() {
      const frame = stack.pop()
      if (!frame || frame.key === null) return
      const edges = graph.get(frame.key) ?? new Set<string>()
      for (const reference of frame.references) edges.add(reference)
      graph.set(frame.key, edges)
    }

    function reference(node: ESTree.Node, key: string) {
      for (const frame of stack) {
        if (frame.node.body && isWithin(node, frame.node.body)) frame.references.add(key)
      }
    }

    return {
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': exit,
      FunctionExpression: enter,
      'FunctionExpression:exit': exit,
      Identifier(node) {
        if (isBindingReference(node)) reference(node, node.name)
      },
      MemberExpression(node) {
        if (node.object.type !== 'ThisExpression' || node.computed) return
        const name = nameOf(node.property)
        if (name !== null) reference(node, `this.${name}`)
      },
      'Program:exit'() {
        for (const { frame, returnType } of candidates) {
          if (isRecursive(frame, graph)) continue
          context.report({
            node: returnType,
            messageId: 'unneededReturnType',
            fix(fixer) {
              return fixer.remove(returnType)
            },
          })
        }
      },
    }
  },
}
