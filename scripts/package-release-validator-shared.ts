import { parsePackageReleaseWorkflow, workflowActionUses } from './package-release-validator-workflow-structure'
import { RELEASE_PLEASE_CONTRACT } from './release-please-contract'

export const DIRECT_NODE = 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON'

const APPROVED_ACTIONS = [
  { name: 'actions/attest-build-provenance', sha: '977bb373ede98d70efdf65b84cb5f73e068dcc2a', version: 'v3' },
  { name: 'actions/cache', sha: '0057852bfaa89a56745cba8c7296529d2fc39830', version: 'v4' },
  { name: 'actions/checkout', sha: 'df4cb1c069e1874edd31b4311f1884172cec0e10', version: 'v6' },
  { name: 'actions/download-artifact', sha: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', version: 'v8' },
  { name: 'actions/setup-node', sha: '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', version: 'v6' },
  { name: 'actions/upload-artifact', sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', version: 'v7' },
  {
    name: 'googleapis/release-please-action',
    sha: RELEASE_PLEASE_CONTRACT.actionSha,
    version: RELEASE_PLEASE_CONTRACT.actionVersion,
  },
  { name: 'oven-sh/setup-bun', sha: '0c5077e51419868618aeaa5fe8019c62421857d6', version: 'v2' },
  { name: 'pnpm/action-setup', sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1', version: 'v4' },
] as const

/*
 * Repo-owned composite actions are source-controlled with the workflow itself, so they
 * cannot drift the way an unpinned third-party ref can. They still cannot hide step
 * changes: the CI policy pins every required job's step sequence byte-for-byte, and the
 * AST contract hash covers the composite action file referenced here.
 */
const REPO_OWNED_ACTION_REFS: readonly string[] = ['./.github/actions/pnpm-install']

export function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

export function requireText(
  source: string,
  requirements: readonly (readonly [string, string])[],
  violations: string[],
) {
  for (const [snippet, message] of requirements) {
    addViolation(!source.includes(snippet), message, violations)
  }
}

export function workflowJobBlock(workflowText: string, jobName: string) {
  const marker = `  ${jobName}:\n`
  const start = workflowText.indexOf(marker)
  if (start < 0) return ''
  const remainder = workflowText.slice(start + marker.length)
  const nextJob = remainder.search(/^ {2}[a-zA-Z0-9_-]+:\s*$/m)
  return nextJob < 0 ? remainder : remainder.slice(0, nextJob)
}

function validateWorkflowActions(
  workflowPath: string,
  workflowRoot: unknown,
  violations: string[],
) {
  const approvedByName = new Map<
    string,
    (typeof APPROVED_ACTIONS)[number]
  >(APPROVED_ACTIONS.map((action) => [action.name, action]))
  for (const use of workflowActionUses(workflowRoot)) {
    if (use.ref === undefined) {
      violations.push(`${workflowPath} uses values must be strings.`)
      continue
    }
    if (REPO_OWNED_ACTION_REFS.includes(use.ref)) {
      continue
    }
    const separator = use.ref.lastIndexOf('@')
    const name = separator < 0 ? use.ref : use.ref.slice(0, separator)
    const approved = approvedByName.get(name)
    addViolation(approved === undefined, `${workflowPath} executes unapproved action ${name}.`, violations)
    if (approved === undefined) continue
    const expectedRef = `${approved.name}@${approved.sha}`
    addViolation(use.ref !== expectedRef, `${workflowPath} must execute ${approved.name} at its approved immutable ${approved.version} SHA.`, violations)
    addViolation(use.versionComment !== approved.version, `${workflowPath} ${approved.name} uses must retain the approved # ${approved.version} comment.`, violations)
  }
}

export function validateYaml(workflowPath: string, workflowText: string, violations: string[]) {
  const parsed = parsePackageReleaseWorkflow(workflowText)
  for (const error of parsed.errors) {
    violations.push(`${workflowPath} must contain valid YAML: ${error}`)
  }
  validateWorkflowActions(workflowPath, parsed.root, violations)
}
