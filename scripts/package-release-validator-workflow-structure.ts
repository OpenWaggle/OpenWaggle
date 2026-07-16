import { createHash } from 'node:crypto'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'

const EMPTY_COUNT = 0
const CI_WORKFLOW_AST_CONTRACT = 'c219781be711dd5535c366f3f88c7470d38d34e9955fd9956ee494f0ade79e03'

export interface WorkflowActionUse {
  readonly ref?: string
  readonly versionComment?: string
}

export function parsePackageReleaseWorkflow(workflowText: string) {
  const document = parseDocument(workflowText, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  return {
    errors: document.errors.map((error) => error.message),
    root: document.contents,
  }
}

function stripYamlComment(line: string) {
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    if (character === '"' && !inSingleQuote && line[index - 1] !== '\\') {
      inDoubleQuote = !inDoubleQuote
    }
    if (character === '#' && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, index).trimEnd()
    }
  }
  return line
}

export function executableWorkflowText(workflowText: string) {
  return workflowText
    .split('\n')
    .map(stripYamlComment)
    .filter((line) => line.trim().length > EMPTY_COUNT)
    .join('\n')
}

function collectWorkflowRunCommands(node: unknown, commands: string[]) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (
        isScalar(pair.key) &&
        pair.key.value === 'run' &&
        isScalar(pair.value) &&
        typeof pair.value.value === 'string'
      ) {
        commands.push(pair.value.value)
      }
      collectWorkflowRunCommands(pair.value, commands)
    }
    return
  }
  if (isSeq(node)) {
    for (const item of node.items) collectWorkflowRunCommands(item, commands)
  }
}

export function workflowRunCommands(workflowText: string) {
  const commands: string[] = []
  collectWorkflowRunCommands(parsePackageReleaseWorkflow(workflowText).root, commands)
  return commands
}

function collectWorkflowActionUses(node: unknown, uses: WorkflowActionUse[]) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (isScalar(pair.key) && pair.key.value === 'uses') {
        const value = pair.value
        if (isScalar(value) && typeof value.value === 'string') {
          const versionComment = value.comment?.trim()
          uses.push(versionComment ? { ref: value.value, versionComment } : { ref: value.value })
        } else {
          uses.push({})
        }
      }
      collectWorkflowActionUses(pair.value, uses)
    }
    return
  }
  if (isSeq(node)) {
    for (const item of node.items) collectWorkflowActionUses(item, uses)
  }
}

export function workflowActionUses(workflowRoot: unknown) {
  const uses: WorkflowActionUse[] = []
  collectWorkflowActionUses(workflowRoot, uses)
  return uses
}

function contractValue(node: unknown): unknown {
  if (isMap(node)) {
    return node.items.map((pair) => [contractValue(pair.key), contractValue(pair.value)])
  }
  if (isSeq(node)) return node.items.map(contractValue)
  if (isScalar(node)) return node.value
  return null
}

export function workflowAstContractHash(workflowRoot: unknown) {
  return createHash('sha256').update(JSON.stringify(contractValue(workflowRoot))).digest('hex')
}

export function workflowUsesYamlReferences(node: unknown): boolean {
  if (isAlias(node)) return true
  if (isMap(node)) {
    return (
      Boolean(node.anchor) ||
      node.items.some(
        (pair) => workflowUsesYamlReferences(pair.key) || workflowUsesYamlReferences(pair.value),
      )
    )
  }
  if (isSeq(node)) {
    return Boolean(node.anchor) || node.items.some(workflowUsesYamlReferences)
  }
  return isScalar(node) && Boolean(node.anchor)
}

export function matchesReleaseCiWorkflowAstContract(workflowText: string) {
  const parsed = parsePackageReleaseWorkflow(workflowText)
  return (
    parsed.errors.length === 0 &&
    !workflowUsesYamlReferences(parsed.root) &&
    workflowAstContractHash(parsed.root) === CI_WORKFLOW_AST_CONTRACT
  )
}
