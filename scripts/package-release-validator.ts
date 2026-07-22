import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePackageReleasePipelines } from './package-release-validator-pipeline'
import { validatePackageReleaseProvenance } from './package-release-validator-provenance'
import { RELEASE_PLEASE_CONTRACT } from './release-please-contract'
import { validateReleasePleaseRuntimeContract } from './release-please-runtime-contract'

const BOOTSTRAP_SOURCE_VERSION = '0.0.0'
const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
const CLI_ARGUMENT_START_INDEX = 2
const CONFIG_PATH = 'release-please-config.json'
const EMPTY_COUNT = 0
const FAILURE_EXIT_CODE = 1
const INITIAL_PUBLIC_PACKAGE_VERSION = '0.1.0'
const PACKAGE_RELEASE_TITLE_PATTERN = 'chore(${branch}): release OpenWaggle packages'
const MANIFEST_PATH = '.release-please-manifest.json'
const ROOT_PACKAGE_PATH = 'package.json'
const WORKFLOW_PATH = '.github/workflows/package-release.yml'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

interface ExpectedPackage {
  readonly component: string
  readonly dependency?: string
  readonly name: string
  readonly path: string
}

type JsonObject = { readonly [key: string]: unknown }

export interface PackageReleaseValidationResult {
  readonly violations: readonly string[]
}

const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
  {
    component: 'extension-sdk',
    name: '@openwaggle/extension-sdk',
    path: 'packages/extension-sdk',
  },
  {
    component: 'extension-react',
    dependency: '@openwaggle/extension-sdk',
    name: '@openwaggle/extension-react',
    path: 'packages/extension-react',
  },
  {
    component: 'waggle-core',
    name: '@openwaggle/waggle-core',
    path: 'packages/waggle-core',
  },
  {
    component: 'pi-waggle',
    dependency: '@openwaggle/waggle-core',
    name: '@openwaggle/pi-waggle',
    path: 'packages/pi-waggle',
  },
]


function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getObject(value: JsonObject, key: string) {
  const child = value[key]
  return isJsonObject(child) ? child : undefined
}

function getStringArray(value: JsonObject, key: string) {
  const child = value[key]
  return Array.isArray(child) && child.every((item) => typeof item === 'string')
    ? child
    : undefined
}

function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

async function pathExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(projectRoot: string, filePath: string, violations: string[]) {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(projectRoot, filePath), 'utf8'))
    if (isJsonObject(parsed)) return parsed
    violations.push(`${filePath} must contain a JSON object.`)
  } catch (error) {
    violations.push(`${filePath} must be readable JSON: ${String(error)}`)
  }
  return undefined
}

function validateExactPackagePaths(
  actualPaths: readonly string[],
  sourcePath: string,
  violations: string[],
) {
  const expectedPaths = EXPECTED_PACKAGES.map((item) => item.path)
  addViolation(
    actualPaths.length !== EXPECTED_PACKAGES.length,
    `${sourcePath} must configure exactly the four publishable packages.`,
    violations,
  )
  for (const expectedPath of expectedPaths) {
    addViolation(!actualPaths.includes(expectedPath), `${sourcePath} is missing ${expectedPath}.`, violations)
  }
  for (const actualPath of actualPaths) {
    addViolation(!expectedPaths.includes(actualPath), `${sourcePath} contains unexpected package path ${actualPath}.`, violations)
  }
}

function pluginType(plugin: unknown) {
  if (typeof plugin === 'string') return plugin
  return isJsonObject(plugin) && typeof plugin.type === 'string' ? plugin.type : undefined
}

function validateReleasePleaseConfig(config: JsonObject | undefined, violations: string[]) {
  if (config === undefined) return
  const requirements: readonly (readonly [boolean, string])[] = [
    [config['release-type'] !== 'node', `${CONFIG_PATH} must default publishable packages to release-type node.`],
    [config['initial-version'] !== INITIAL_PUBLIC_PACKAGE_VERSION, `${CONFIG_PATH} must set initial-version to ${INITIAL_PUBLIC_PACKAGE_VERSION}.`],
    [config['bump-minor-pre-major'] !== true, `${CONFIG_PATH} must minor-bump pre-1 breaking changes.`],
    [config['bump-patch-for-minor-pre-major'] === true, `${CONFIG_PATH} must minor-bump pre-1 feature changes.`],
    [config['include-component-in-tag'] !== true || config['include-v-in-tag'] !== true, `${CONFIG_PATH} must produce package-name tags like extension-sdk-v0.1.0.`],
    [config['separate-pull-requests'] !== false, `${CONFIG_PATH} must create one coordinated package release PR.`],
    [config['always-link-local'] !== true, `${CONFIG_PATH} must patch-bump local dependents when base packages release.`],
    [config['group-pull-request-title-pattern'] !== PACKAGE_RELEASE_TITLE_PATTERN, `${CONFIG_PATH} must generate the policy-compatible coordinated release title.`],
  ]
  for (const [condition, message] of requirements) addViolation(condition, message, violations)
  const plugins = Array.isArray(config.plugins) ? config.plugins.map(pluginType) : []
  addViolation(!plugins.includes('node-workspace'), `${CONFIG_PATH} must enable the node-workspace plugin for dependent bumps.`, violations)
  addViolation(plugins.includes('linked-versions'), `${CONFIG_PATH} must keep package versions independent.`, violations)
  const packages = getObject(config, 'packages')
  if (packages === undefined) {
    violations.push(`${CONFIG_PATH} must define packages.`)
    return
  }
  validateExactPackagePaths(Object.keys(packages), CONFIG_PATH, violations)
  for (const expected of EXPECTED_PACKAGES) {
    const packageConfig = getObject(packages, expected.path)
    if (packageConfig === undefined) continue
    addViolation(packageConfig['package-name'] !== expected.name, `${CONFIG_PATH} ${expected.path} must set package-name.`, violations)
    addViolation(packageConfig.component !== expected.component, `${CONFIG_PATH} ${expected.path} must set short component.`, violations)
    addViolation(packageConfig['changelog-path'] !== 'CHANGELOG.md', `${CONFIG_PATH} ${expected.path} must use package-local CHANGELOG.md.`, violations)
  }
}

function validateReleasePleaseManifest(manifest: JsonObject | undefined, violations: string[]) {
  if (manifest === undefined || Object.keys(manifest).length === EMPTY_COUNT) return
  validateExactPackagePaths(Object.keys(manifest), MANIFEST_PATH, violations)
  for (const expected of EXPECTED_PACKAGES) {
    const version = manifest[expected.path]
    addViolation(
      typeof version !== 'string' || !SEMVER_PATTERN.test(version),
      `${MANIFEST_PATH} ${expected.path} must contain a semver version.`,
      violations,
    )
  }
}

async function validatePackageMetadata(
  projectRoot: string,
  manifest: JsonObject | undefined,
  violations: string[],
) {
  const bootstrap = manifest !== undefined && Object.keys(manifest).length === EMPTY_COUNT
  for (const expected of EXPECTED_PACKAGES) {
    const packageJsonPath = `${expected.path}/package.json`
    const packageJson = await readJsonFile(projectRoot, packageJsonPath, violations)
    if (packageJson === undefined) continue
    const version = packageJson.version
    const manifestVersion = manifest?.[expected.path]
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
  const scripts = packageJson === undefined ? undefined : getObject(packageJson, 'scripts')
  const devDependencies =
    packageJson === undefined ? undefined : getObject(packageJson, 'devDependencies')
  const checkScript = scripts?.check
  if (typeof checkScript !== 'string') {
    violations.push(`${ROOT_PACKAGE_PATH} scripts.check must exist.`)
    return
  }
  addViolation(!checkScript.includes('pnpm package:smoke'), `${ROOT_PACKAGE_PATH} scripts.check must run pnpm package:smoke.`, violations)
  addViolation(scripts?.['package-release:publish'] !== 'node scripts/package-release-publish.ts', `${ROOT_PACKAGE_PATH} scripts.package-release:publish must execute only the dependency-free typed package release publisher with Node.`, violations)
  addViolation(
    devDependencies?.['release-please'] !== RELEASE_PLEASE_CONTRACT.bundledRuntimeVersion,
    `${ROOT_PACKAGE_PATH} must pin release-please ${RELEASE_PLEASE_CONTRACT.bundledRuntimeVersion} for deterministic preflight contracts.`,
    violations,
  )
}

export async function validatePackageReleaseFiles(
  projectRoot = process.cwd(),
): Promise<PackageReleaseValidationResult> {
  const violations: string[] = []
  const [config, manifest, packageJson] = await Promise.all([
    readJsonFile(projectRoot, CONFIG_PATH, violations),
    readJsonFile(projectRoot, MANIFEST_PATH, violations),
    readJsonFile(projectRoot, ROOT_PACKAGE_PATH, violations),
  ])
  validateReleasePleaseConfig(config, violations)
  if (typeof config?.['group-pull-request-title-pattern'] === 'string') {
    violations.push(
      ...(await validateReleasePleaseRuntimeContract(
        config['group-pull-request-title-pattern'],
      )),
    )
  }
  validateReleasePleaseManifest(manifest, violations)
  validateRootPackageScripts(packageJson, violations)
  await validatePackageMetadata(projectRoot, manifest, violations)

  const [
    workflowText,
    ciWorkflowText,
    contextSource,
    promoteSource,
    promotionSource,
    artifactsSource,
    contractSource,
    locatorSource,
    provenanceSource,
  ] = await Promise.all([
    readFile(path.join(projectRoot, WORKFLOW_PATH), 'utf8'),
    readFile(path.join(projectRoot, CI_WORKFLOW_PATH), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-context.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-promote.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-promotion.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-artifacts.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-artifact-contract.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-artifact-locator.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'scripts/package-release-provenance.ts'), 'utf8'),
  ])
  validatePackageReleasePipelines({
    artifactsSource: `${artifactsSource}\n${contractSource}`,
    ciWorkflowText,
    contextSource,
    locatorSource,
    promoteSource: `${promoteSource}\n${promotionSource}`,
    workflowText,
  }, violations)
  validatePackageReleaseProvenance(provenanceSource, violations)
  return { violations }
}

export async function runPackageReleaseValidatorCli() {
  const result = await validatePackageReleaseFiles()
  if (result.violations.length === EMPTY_COUNT) return 0
  for (const violation of result.violations) console.error(`- ${violation}`)
  return FAILURE_EXIT_CODE
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPackageReleaseValidatorCli().then((exitCode) => {
    process.exitCode = exitCode
  })
}
