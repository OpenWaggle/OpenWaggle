import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  executableShellLines,
  executableWorkflowText,
  parsePackageReleaseWorkflow,
  runsCommandFragment,
  workflowActionUses,
  workflowRunCommands,
  validatePublicationBoundary,
} from './package-release-validator-workflow-structure'
import {
  jobHasDedicatedExactRunStep,
} from './package-release-validator-workflow-steps'
import { validateWorkflowRecovery } from './package-release-validator-recovery'
import { validateWorkflowConsumerSmoke } from './package-release-validator-consumers'
import { validateCiWorkflowText } from './package-release-validator-ci'

type JsonObject = { readonly [key: string]: unknown }
interface ExpectedPackage { readonly component: string; readonly dependency?: string; readonly name: string; readonly path: string }
export interface PackageReleaseValidationResult { readonly violations: readonly string[] }

const FAILURE_EXIT_CODE = 1; const EMPTY_COUNT = 0
const JOB_INDENT_WIDTH = 2; const BOOTSTRAP_SOURCE_VERSION = '0.0.0'; const INITIAL_PUBLIC_PACKAGE_VERSION = '0.1.0'
const CONFIG_PATH = 'release-please-config.json'; const MANIFEST_PATH = '.release-please-manifest.json'
const WORKFLOW_PATH = '.github/workflows/package-release.yml'; const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'; const ROOT_PACKAGE_PATH = 'package.json'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
  { component: 'extension-sdk', name: '@openwaggle/extension-sdk', path: 'packages/extension-sdk' }, { component: 'extension-react', dependency: '@openwaggle/extension-sdk', name: '@openwaggle/extension-react', path: 'packages/extension-react' },
  { component: 'waggle-core', name: '@openwaggle/waggle-core', path: 'packages/waggle-core' }, { component: 'pi-waggle', dependency: '@openwaggle/waggle-core', name: '@openwaggle/pi-waggle', path: 'packages/pi-waggle' },
]
const EXPECTED_ACTIONS = [
  { name: 'actions/checkout', sha: 'df4cb1c069e1874edd31b4311f1884172cec0e10', version: 'v6' }, { name: 'actions/download-artifact', sha: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', version: 'v8' },
  { name: 'actions/setup-node', sha: '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', version: 'v6' }, { name: 'actions/upload-artifact', sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', version: 'v7' },
  { name: 'googleapis/release-please-action', sha: '45996ed1f6d02564a971a2fa1b5860e934307cf7', version: 'v5' }, { name: 'oven-sh/setup-bun', sha: '0c5077e51419868618aeaa5fe8019c62421857d6', version: 'v2' },
  { name: 'pnpm/action-setup', sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1', version: 'v4' },
] as const

function isJsonObject(value: unknown): value is JsonObject { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function getObject(value: JsonObject, key: string) { const child = value[key]; return isJsonObject(child) ? child : undefined }

function getStringArray(value: JsonObject, key: string) { const child = value[key]; return Array.isArray(child) && child.every((item) => typeof item === 'string') ? child : undefined }

function addViolation(condition: boolean, message: string, violations: string[]) { if (condition) violations.push(message) }

function requireText(source: string, requirements: readonly (readonly [string, string])[], violations: string[]) { for (const [snippet, message] of requirements) addViolation(!source.includes(snippet), message, violations) }

async function pathExists(filePath: string) {
  try { await access(filePath); return true } catch { return false }
}

async function readJsonFile(projectRoot: string, filePath: string, violations: string[]) {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectRoot, filePath), 'utf8'))
    if (isJsonObject(parsed)) return parsed
    violations.push(`${filePath} must contain a JSON object.`)
  } catch (error) { violations.push(`${filePath} must be readable JSON: ${String(error)}`) }
  return undefined
}

function validateExactPackagePaths(actualPaths: readonly string[], sourcePath: string, violations: string[]) {
  const expectedPaths = EXPECTED_PACKAGES.map((item) => item.path)
  addViolation(actualPaths.length !== EXPECTED_PACKAGES.length, `${sourcePath} must configure exactly the four publishable packages.`, violations)
  for (const expectedPath of expectedPaths) addViolation(!actualPaths.includes(expectedPath), `${sourcePath} is missing ${expectedPath}.`, violations)
  for (const actualPath of actualPaths) addViolation(!expectedPaths.includes(actualPath), `${sourcePath} contains unexpected package path ${actualPath}.`, violations)
}

function pluginType(plugin: unknown) {
  if (typeof plugin === 'string') return plugin
  return isJsonObject(plugin) && typeof plugin.type === 'string' ? plugin.type : undefined
}

function validateReleasePleaseConfig(config: JsonObject | undefined, violations: string[]) {
  if (!config) return
  const requirements: readonly (readonly [boolean, string])[] = [
    [config['release-type'] !== 'node', `${CONFIG_PATH} must default publishable packages to release-type node.`],
    [config['initial-version'] !== INITIAL_PUBLIC_PACKAGE_VERSION, `${CONFIG_PATH} must set initial-version to ${INITIAL_PUBLIC_PACKAGE_VERSION}.`],
    [config['bump-minor-pre-major'] !== true, `${CONFIG_PATH} must minor-bump pre-1 breaking changes.`],
    [config['bump-patch-for-minor-pre-major'] === true, `${CONFIG_PATH} must minor-bump pre-1 feature changes.`],
    [config['include-component-in-tag'] !== true || config['include-v-in-tag'] !== true, `${CONFIG_PATH} must produce package-name tags like extension-sdk-v0.1.0.`],
    [config['separate-pull-requests'] !== false, `${CONFIG_PATH} must create one coordinated package release PR.`],
    [config['always-link-local'] !== true, `${CONFIG_PATH} must patch-bump local dependents when base packages release.`],
  ]
  for (const [condition, message] of requirements) addViolation(condition, message, violations)
  const plugins = Array.isArray(config.plugins) ? config.plugins.map(pluginType) : []
  addViolation(!plugins.includes('node-workspace'), `${CONFIG_PATH} must enable the node-workspace plugin for dependent bumps.`, violations)
  addViolation(plugins.includes('linked-versions'), `${CONFIG_PATH} must keep package versions independent.`, violations)
  const packages = getObject(config, 'packages')
  if (!packages) { violations.push(`${CONFIG_PATH} must define packages.`); return }
  validateExactPackagePaths(Object.keys(packages), CONFIG_PATH, violations)
  for (const expected of EXPECTED_PACKAGES) {
    const packageConfig = getObject(packages, expected.path)
    if (!packageConfig) continue
    addViolation(packageConfig['package-name'] !== expected.name, `${CONFIG_PATH} ${expected.path} must set package-name.`, violations)
    addViolation(packageConfig.component !== expected.component, `${CONFIG_PATH} ${expected.path} must set short component.`, violations)
    addViolation(packageConfig['changelog-path'] !== 'CHANGELOG.md', `${CONFIG_PATH} ${expected.path} must use package-local CHANGELOG.md.`, violations)
  }
}

function validateReleasePleaseManifest(manifest: JsonObject | undefined, violations: string[]) {
  if (!manifest || Object.keys(manifest).length === EMPTY_COUNT) return
  validateExactPackagePaths(Object.keys(manifest), MANIFEST_PATH, violations)
  for (const expected of EXPECTED_PACKAGES) {
    const version = manifest[expected.path]
    addViolation(typeof version !== 'string' || !SEMVER_PATTERN.test(version), `${MANIFEST_PATH} ${expected.path} must contain a semver version.`, violations)
  }
}

async function validatePackageMetadata(projectRoot: string, manifest: JsonObject | undefined, violations: string[]) {
  const bootstrap = manifest !== undefined && Object.keys(manifest).length === EMPTY_COUNT
  for (const expected of EXPECTED_PACKAGES) {
    const packageJsonPath = `${expected.path}/package.json`
    const packageJson = await readJsonFile(projectRoot, packageJsonPath, violations)
    if (!packageJson) continue
    const version = packageJson.version; const manifestVersion = manifest?.[expected.path]
    addViolation(packageJson.name !== expected.name, `${packageJsonPath} must use package name ${expected.name}.`, violations)
    addViolation(typeof version !== 'string' || !SEMVER_PATTERN.test(version), `${packageJsonPath} must contain a semver version.`, violations)
    addViolation(bootstrap && version !== BOOTSTRAP_SOURCE_VERSION, `${packageJsonPath} bootstrap version must be ${BOOTSTRAP_SOURCE_VERSION}.`, violations)
    addViolation(typeof manifestVersion === 'string' && version !== manifestVersion, `${packageJsonPath} version must stay aligned with ${MANIFEST_PATH}.`, violations)
    addViolation(getObject(packageJson, 'publishConfig')?.access !== 'public', `${packageJsonPath} must declare publishConfig.access public.`, violations)
    addViolation(getObject(packageJson, 'engines')?.node !== '>=22.19.0', `${packageJsonPath} must require Node.js >=22.19.0.`, violations)
    addViolation(Boolean(expected.dependency && getObject(packageJson, 'dependencies')?.[expected.dependency] !== 'workspace:^'), `${packageJsonPath} must depend on ${expected.dependency} through workspace:^.`, violations)
    addViolation(!(getStringArray(packageJson, 'files') ?? []).includes('CHANGELOG.md'), `${packageJsonPath} files must include CHANGELOG.md.`, violations)
    addViolation(!(await pathExists(path.join(projectRoot, expected.path, 'CHANGELOG.md'))), `${expected.path}/CHANGELOG.md must exist before Release Please runs.`, violations)
  }
}

function validateRootPackageScripts(packageJson: JsonObject | undefined, violations: string[]) {
  const scripts = packageJson ? getObject(packageJson, 'scripts') : undefined
  const checkScript = scripts?.check
  if (typeof checkScript !== 'string') { violations.push(`${ROOT_PACKAGE_PATH} scripts.check must exist.`); return }
  addViolation(!checkScript.includes('pnpm package:smoke'), `${ROOT_PACKAGE_PATH} scripts.check must run pnpm package:smoke.`, violations)
  addViolation(scripts?.['package-release:publish'] !== 'node scripts/package-release-publish.ts', `${ROOT_PACKAGE_PATH} scripts.package-release:publish must execute only the dependency-free typed package release publisher with Node.`, violations)
}

function workflowJobBlock(workflowText: string, jobName: string) {
  const marker = `  ${jobName}:\n`
  const start = workflowText.indexOf(marker)
  if (start === -1) return ''
  const remainder = workflowText.slice(start + marker.length)
  const nextJob = remainder.search(new RegExp(`^ {${JOB_INDENT_WIDTH}}[a-zA-Z0-9_-]+:\\s*$`, 'm'))
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob)
}

function mappingBlock(source: string, mappingName: string, indent: string) {
  const marker = `${indent}${mappingName}:\n`
  const start = source.indexOf(marker)
  if (start === -1) return ''
  const remainder = source.slice(start + marker.length)
  const nextEntry = remainder.search(new RegExp(`^${indent}[a-zA-Z0-9_-]+:`, 'm'))
  return nextEntry === -1 ? remainder : remainder.slice(0, nextEntry)
}

function hasExactMappingEntries(block: string, expectedEntries: readonly string[]) { const entries = block.split('\n').map((line) => line.trim()).filter(Boolean); return entries.length === expectedEntries.length && expectedEntries.every((entry) => entries.includes(entry)) }

function validateWorkflowActions(workflowRoot: unknown, violations: string[]) {
  const actualUses = workflowActionUses(workflowRoot); const actualRefs = actualUses.flatMap((use) => use.ref ?? [])
  for (const use of actualUses) {
    addViolation(use.ref === undefined, `${WORKFLOW_PATH} uses values must be strings.`, violations)
    if (use.ref === undefined) continue
    addViolation(!/^[^@\s]+@[0-9a-f]{40}$/.test(use.ref), `${WORKFLOW_PATH} must pin every uses reference to a full 40-character lowercase commit SHA: ${use.ref}.`, violations)
    addViolation(!use.versionComment, `${WORKFLOW_PATH} uses references must include a # vN version comment: ${use.ref}.`, violations)
  } for (const expected of EXPECTED_ACTIONS) {
    const expectedRef = `${expected.name}@${expected.sha}`; addViolation(!actualRefs.includes(expectedRef), `${WORKFLOW_PATH} must execute ${expected.name} at its approved immutable ${expected.version} SHA.`, violations)
    addViolation(actualRefs.some((ref) => ref.startsWith(`${expected.name}@`) && ref !== expectedRef), `${WORKFLOW_PATH} must not execute an unapproved ref for ${expected.name}.`, violations)
    addViolation(actualUses.some((use) => use.ref === expectedRef && use.versionComment !== expected.version), `${WORKFLOW_PATH} ${expected.name} uses must retain the approved # ${expected.version} comment.`, violations)
  } }

function validateNoFailOpenSteps(workflowText: string, violations: string[]) {
  addViolation(/^\s*continue-on-error:\s*true\s*$/m.test(workflowText), `${WORKFLOW_PATH} must not use continue-on-error.`, violations)
  addViolation(workflowRunCommands(workflowText).some((command) => executableShellLines(command).some((line) => /\|\|\s*(?:true|:)(?:\s|$)/.test(line))), `${WORKFLOW_PATH} must not use fail-open shell commands.`, violations)
}

function validateWorkflowPermissions(workflowText: string, violations: string[]) {
  addViolation(!hasExactMappingEntries(mappingBlock(workflowText, 'permissions', ''), ['contents: read']), `${WORKFLOW_PATH} must grant only contents: read by default.`, violations)
  const releasePermissions = mappingBlock(workflowJobBlock(workflowText, 'release-please'), 'permissions', '    ')
  addViolation(releasePermissions.includes('issues: write'), `${WORKFLOW_PATH} release-please must not grant issues: write.`, violations)
  addViolation(!hasExactMappingEntries(releasePermissions, ['actions: write', 'contents: write', 'pull-requests: write']), `${WORKFLOW_PATH} release-please must grant only actions: write, contents: write, and pull-requests: write.`, violations)
  for (const jobName of ['publish-bases', 'publish-dependents']) {
    const job = workflowJobBlock(workflowText, jobName); const permissions = mappingBlock(job, 'permissions', '    ')
    addViolation(!permissions.includes('id-token: write'), `${WORKFLOW_PATH} ${jobName} must grant id-token: write.`, violations)
    addViolation(!hasExactMappingEntries(permissions, ['id-token: write']), `${WORKFLOW_PATH} ${jobName} must grant only id-token: write.`, violations)
    addViolation(!job.includes('package-manager-cache: false'), `${WORKFLOW_PATH} ${jobName} must disable setup-node package-manager caching.`, violations)
  }
}

function validateWorkflowPathsAndDispatch(workflowText: string, violations: string[]) {
  for (const expected of EXPECTED_PACKAGES) {
    addViolation(!workflowText.includes(`${expected.path}/**`), `${WORKFLOW_PATH} must scope push releases to ${expected.path}/**.`, violations)
    const prefix = `steps.release.outputs['${expected.path}--`
    addViolation(!['release_created', 'tag_name', 'version', 'sha'].every((suffix) => workflowText.includes(`${prefix}${suffix}']`)), `${WORKFLOW_PATH} must use Release Please tag/version/SHA outputs for ${expected.path}.`, violations)
  }
  addViolation(!workflowText.includes('event=pull_request&branch=${HEAD_REF}'), `${WORKFLOW_PATH} must find PR-associated ci.yml runs for Release Please PRs.`, violations)
  addViolation(!(workflowText.includes('--arg sha "$HEAD_SHA"') && workflowText.includes('.head_sha == $sha and .event == "pull_request"')), `${WORKFLOW_PATH} must select PR-associated CI by the exact release PR head SHA.`, violations)
  addViolation(!workflowText.includes('actions/workflows/ci.yml/dispatches'), `${WORKFLOW_PATH} must fall back to dispatching ci.yml for Release Please PRs.`, violations)
  addViolation(!workflowText.includes('inputs: {head_sha: $sha}'), `${WORKFLOW_PATH} must dispatch fallback CI with the exact release PR head SHA.`, violations)
  addViolation(!workflowText.includes('gh run rerun "$RUN_ID"') || !workflowText.includes('gh run watch "$RUN_ID" --exit-status'), `${WORKFLOW_PATH} must rerun and wait for approval-required Release Please PR CI.`, violations)
  addViolation(!(workflowText.includes('RUN_CONCLUSION" = "action_required"') && workflowText.includes('RUN_STATUS" != "completed"') && workflowText.includes('FINAL_CONCLUSION" = "success"')), `${WORKFLOW_PATH} must safely rerun, watch, or accept exact-head release PR CI based on its current state.`, violations)
  addViolation(!workflowText.includes('actions: write') || !workflowText.includes('github.token'), `${WORKFLOW_PATH} must rerun CI with the scoped GITHUB_TOKEN.`, violations)
}

function validatePublicationJob(workflowText: string, jobName: string, violations: string[]) {
  const job = workflowJobBlock(workflowText, jobName)
  addViolation(!runsCommandFragment(job, 'if [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]'), `${WORKFLOW_PATH} ${jobName} must verify the GitHub OIDC environment.`, violations)
  addViolation(!runsCommandFragment(job, 'sha256sum --check SHA256SUMS') || !runsCommandFragment(job, 'tar -xOf "$TARBALL" package/package.json'), `${WORKFLOW_PATH} ${jobName} must checksum and inspect the exact tarball.`, violations)
  addViolation(!job.includes('environment: npm'), `${WORKFLOW_PATH} ${jobName} must use the protected npm environment.`, violations)
  addViolation(!runsCommandFragment(job, 'if npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version'), `${WORKFLOW_PATH} ${jobName} must publish only a missing exact version.`, violations)
  addViolation(!runsCommandFragment(job, "grep -Eq 'E404|404 Not Found'"), `${WORKFLOW_PATH} ${jobName} must distinguish a missing version from registry failures.`, violations)
}

function validateWorkflowPublication(workflowRoot: unknown, workflowText: string, violations: string[]) {
  const publicationJobs = ['publish-bases', 'publish-dependents'] as const
  for (const jobName of publicationJobs) validatePublicationJob(workflowText, jobName, violations)
  const boundary = validatePublicationBoundary(workflowRoot)
  for (const jobName of boundary.jobsWithInvalidContract) {
    violations.push(`${WORKFLOW_PATH} ${jobName} must match its exact allowlisted job contract.`)
  }
  for (const jobName of boundary.jobsWithInvalidRuntime) {
    violations.push(
      `${WORKFLOW_PATH} ${jobName} must pin Node 24.14.0 and verify npm 11.9.0 before publication.`,
    )
  }
  addViolation(boundary.jobsWithInvalidPublisher.length > EMPTY_COUNT, `${WORKFLOW_PATH} must invoke only the dedicated publication command in publish-bases and publish-dependents.`, violations)
  for (const jobName of boundary.jobsWithForbiddenInstall) {
    violations.push(`${WORKFLOW_PATH} ${jobName} must not install dependencies or package managers in an OIDC publication job.`)
  }
  for (const jobName of boundary.jobsWithInvalidCapability) {
    violations.push(
      `${WORKFLOW_PATH} ${jobName} must exclusively hold id-token: write with environment npm.`,
    )
  }
  addViolation(boundary.unauthorizedCapabilityJobs.length > EMPTY_COUNT, `${WORKFLOW_PATH} must reserve id-token: write and environment declarations for publish-bases and publish-dependents.`, violations)
  addViolation(boundary.workflowControlsInvalid, `${WORKFLOW_PATH} must forbid workflow-level env and defaults and grant exactly contents: read.`, violations)
  addViolation(boundary.workflowUsesYamlReferences, `${WORKFLOW_PATH} must not use YAML aliases or anchors.`, violations)
  const exactTarballsMissing = publicationJobs.some((jobName) => {
    const job = workflowJobBlock(workflowText, jobName)
    return !runsCommandFragment(job, 'sha256sum --check SHA256SUMS') || !runsCommandFragment(job, 'tar -xOf "$TARBALL" package/package.json')
  })
  addViolation(exactTarballsMissing, `${WORKFLOW_PATH} must checksum the exact tarball before publication.`, violations)
  addViolation(workflowText.includes('NPM_TOKEN') || workflowText.includes('NODE_AUTH_TOKEN'), `${WORKFLOW_PATH} must not use npm token fallback authentication.`, violations)
  addViolation(workflowText.includes('npm stage publish'), `${WORKFLOW_PATH} must publish directly, never use npm stage publish.`, violations)
  addViolation(workflowText.includes('--provenance=false') || workflowText.includes('NPM_CONFIG_PROVENANCE=false'), `${WORKFLOW_PATH} must keep npm trusted-publishing provenance enabled.`, violations)
  for (const command of ['npm whoami', 'npm trust', 'npm access']) addViolation(workflowText.includes(command), `${WORKFLOW_PATH} must not use token-authenticated npm preflight commands.`, violations)
  addViolation(!runsCommandFragment(workflowText, 'sha256sum --check SHA256SUMS'), `${WORKFLOW_PATH} must checksum the exact tarball before publication.`, violations)
  const dependents = workflowJobBlock(workflowText, 'publish-dependents')
  addViolation(!(dependents.includes('needs: publish-bases') || dependents.includes('- publish-bases')), `${WORKFLOW_PATH} must publish dependent packages after base packages.`, violations)
  addViolation(!dependents.includes('always()'), `${WORKFLOW_PATH} dependents must run after skipped base publication jobs.`, violations)
  addViolation(!dependents.includes("needs.publish-bases.result == 'success'") || !dependents.includes("needs.publish-bases.result == 'skipped'"), `${WORKFLOW_PATH} dependents must stop after failed base publication.`, violations)
  addViolation(!runsCommandFragment(dependents, 'npm view "$DEPENDENCY_NAME@$DEPENDENCY_VERSION" version'), `${WORKFLOW_PATH} must verify base package availability before dependent publication.`, violations)
}

function validateWorkflowText(workflowText: string, violations: string[]) {
  const workflow = parsePackageReleaseWorkflow(workflowText)
  for (const error of workflow.errors) violations.push(`${WORKFLOW_PATH} must contain valid YAML: ${error}`)
  const executableText = executableWorkflowText(workflowText)
  validateWorkflowActions(workflow.root, violations); validateNoFailOpenSteps(executableText, violations)
  validateWorkflowPermissions(executableText, violations); validateWorkflowConsumerSmoke(workflow.root, executableText, violations)
  validateWorkflowPathsAndDispatch(executableText, violations); validateWorkflowPublication(workflow.root, executableText, violations)
  validateWorkflowRecovery(workflow.root, executableText, violations)
  for (const command of ['pnpm package-release:validate', 'pnpm check', 'pnpm build:packages']) addViolation(!jobHasDedicatedExactRunStep(workflow.root, 'validate-dry-run', command), `${WORKFLOW_PATH} must execute ${command}.`, violations)
  const snippets = ['workflow_dispatch:', 'package_tag:', "inputs.package_tag == ''", "inputs.package_tag != ''", `config-file: ${CONFIG_PATH}`, `manifest-file: ${MANIFEST_PATH}`, 'id-token: write', 'environment: npm', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'package-consumer-tools.ts install', 'node scripts/package-release-publish.ts "$TARBALL"', 'node-version: 24.14.0', 'test "$(npm --version)" = "11.9.0"', 'paths_released', "matrix.released == 'true'", 'fail-fast: false', 'tar -xOf "$TARBALL" package/package.json', 'npm view "$PACKAGE_NAME@$PACKAGE_VERSION" version', 'npm view "$DEPENDENCY_NAME@$DEPENDENCY_VERSION" version', 'pnpm package-release:validate', 'pnpm check', 'pnpm build:packages', "github.event_name == 'push'", "github.ref == 'refs/heads/main'", 'group: package-release', 'cancel-in-progress: false']
  requireText(executableText, snippets.map((snippet) => [snippet, `${WORKFLOW_PATH} must contain ${snippet}.`]), violations)
}

async function validateTextFile(projectRoot: string, filePath: string, validate: (text: string, violations: string[]) => void, violations: string[]) {
  try { validate(await readFile(path.join(projectRoot, filePath), 'utf8'), violations) } catch (error) { violations.push(`${filePath} must be readable: ${String(error)}`) }
}

export async function validatePackageReleaseFiles(projectRoot: string): Promise<PackageReleaseValidationResult> {
  const violations: string[] = []
  const [config, manifest, rootPackageJson] = await Promise.all([readJsonFile(projectRoot, CONFIG_PATH, violations), readJsonFile(projectRoot, MANIFEST_PATH, violations), readJsonFile(projectRoot, ROOT_PACKAGE_PATH, violations)])
  validateReleasePleaseConfig(config, violations); validateReleasePleaseManifest(manifest, violations)
  validateRootPackageScripts(rootPackageJson, violations); await validatePackageMetadata(projectRoot, manifest, violations)
  await validateTextFile(projectRoot, WORKFLOW_PATH, validateWorkflowText, violations); await validateTextFile(projectRoot, CI_WORKFLOW_PATH, validateCiWorkflowText, violations)
  return { violations }
}

async function main() { const result = await validatePackageReleaseFiles(process.cwd()); for (const violation of result.violations) console.error(violation); if (result.violations.length !== EMPTY_COUNT) process.exitCode = FAILURE_EXIT_CODE }

if (import.meta.url === `file://${process.argv[1]}`) void main()
