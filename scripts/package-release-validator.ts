import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

type JsonObject = {
  readonly [key: string]: unknown
}

interface ExpectedPackage {
  readonly component: string
  readonly name: string
  readonly path: string
}

export interface PackageReleaseValidationResult {
  readonly violations: readonly string[]
}

const FAILURE_EXIT_CODE = 1
const REQUIRED_PACKAGE_COUNT = 4
const EMPTY_COUNT = 0
const CONFIG_PATH = 'release-please-config.json'
const MANIFEST_PATH = '.release-please-manifest.json'
const WORKFLOW_PATH = '.github/workflows/package-release.yml'
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const EXPECTED_PACKAGES: readonly ExpectedPackage[] = [
  {
    component: 'extension-sdk',
    name: '@openwaggle/extension-sdk',
    path: 'packages/extension-sdk',
  },
  {
    component: 'extension-react',
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

async function pathExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(projectRoot: string, filePath: string, violations: string[]) {
  const absolutePath = path.join(projectRoot, filePath)

  try {
    const parsed: unknown = JSON.parse(await readFile(absolutePath, 'utf8'))
    if (isJsonObject(parsed)) {
      return parsed
    }
    violations.push(`${filePath} must contain a JSON object.`)
  } catch (error) {
    violations.push(`${filePath} must be readable JSON: ${String(error)}`)
  }

  return undefined
}

function validateExactPackagePaths(actualPaths: readonly string[], violations: string[]) {
  const expectedPaths = EXPECTED_PACKAGES.map((item) => item.path).sort()
  const sortedActualPaths = [...actualPaths].sort()

  if (sortedActualPaths.length !== REQUIRED_PACKAGE_COUNT) {
    violations.push(`${CONFIG_PATH} must configure exactly the four publishable packages.`)
  }

  for (const expectedPath of expectedPaths) {
    if (!sortedActualPaths.includes(expectedPath)) {
      violations.push(`${CONFIG_PATH} is missing ${expectedPath}.`)
    }
  }

  for (const actualPath of sortedActualPaths) {
    if (!expectedPaths.includes(actualPath)) {
      violations.push(`${CONFIG_PATH} contains unexpected package path ${actualPath}.`)
    }
  }
}

function pluginType(plugin: unknown) {
  if (typeof plugin === 'string') {
    return plugin
  }
  if (!isJsonObject(plugin)) {
    return undefined
  }
  const value = plugin.type

  return typeof value === 'string' ? value : undefined
}

function validateReleasePleaseConfig(config: JsonObject | undefined, violations: string[]) {
  if (!config) {
    return
  }

  if (config['release-type'] !== 'node') {
    violations.push(`${CONFIG_PATH} must default publishable packages to release-type node.`)
  }
  if (config['include-component-in-tag'] !== true || config['include-v-in-tag'] !== true) {
    violations.push(`${CONFIG_PATH} must produce package-name tags like extension-sdk-v0.1.0.`)
  }

  const plugins = Array.isArray(config.plugins) ? config.plugins : []
  if (!plugins.some((plugin) => pluginType(plugin) === 'node-workspace')) {
    violations.push(`${CONFIG_PATH} must enable the node-workspace plugin for dependent bumps.`)
  }

  const packages = getObject(config, 'packages')
  if (!packages) {
    violations.push(`${CONFIG_PATH} must define packages.`)
    return
  }

  validateExactPackagePaths(Object.keys(packages), violations)

  for (const expectedPackage of EXPECTED_PACKAGES) {
    const packageConfig = getObject(packages, expectedPackage.path)
    if (!packageConfig) {
      continue
    }
    if (packageConfig['package-name'] !== expectedPackage.name) {
      violations.push(`${CONFIG_PATH} ${expectedPackage.path} must set package-name.`)
    }
    if (packageConfig.component !== expectedPackage.component) {
      violations.push(`${CONFIG_PATH} ${expectedPackage.path} must set short component.`)
    }
    if (packageConfig['changelog-path'] !== 'CHANGELOG.md') {
      violations.push(`${CONFIG_PATH} ${expectedPackage.path} must use package-local CHANGELOG.md.`)
    }
  }
}

function validateReleasePleaseManifest(manifest: JsonObject | undefined, violations: string[]) {
  if (!manifest) {
    return
  }

  validateExactPackagePaths(Object.keys(manifest), violations)

  for (const expectedPackage of EXPECTED_PACKAGES) {
    const manifestVersion = manifest[expectedPackage.path]
    if (typeof manifestVersion !== 'string' || !SEMVER_PATTERN.test(manifestVersion)) {
      violations.push(`${MANIFEST_PATH} ${expectedPackage.path} must contain a semver version.`)
    }
  }
}

async function validatePackageMetadata(
  projectRoot: string,
  manifest: JsonObject | undefined,
  violations: string[],
) {
  for (const expectedPackage of EXPECTED_PACKAGES) {
    const packageJsonPath = `${expectedPackage.path}/package.json`
    const packageJson = await readJsonFile(projectRoot, packageJsonPath, violations)
    if (!packageJson) {
      continue
    }

    if (packageJson.name !== expectedPackage.name) {
      violations.push(`${packageJsonPath} must use package name ${expectedPackage.name}.`)
    }
    const manifestVersion = manifest?.[expectedPackage.path]
    if (typeof packageJson.version !== 'string' || !SEMVER_PATTERN.test(packageJson.version)) {
      violations.push(`${packageJsonPath} must contain a semver version.`)
    }
    if (typeof manifestVersion === 'string' && packageJson.version !== manifestVersion) {
      violations.push(`${packageJsonPath} version must stay aligned with ${MANIFEST_PATH}.`)
    }

    const publishConfig = getObject(packageJson, 'publishConfig')
    if (publishConfig?.access !== 'public') {
      violations.push(`${packageJsonPath} must declare publishConfig.access public.`)
    }

    const files = getStringArray(packageJson, 'files') ?? []
    if (!files.includes('CHANGELOG.md')) {
      violations.push(`${packageJsonPath} files must include CHANGELOG.md.`)
    }

    const changelogPath = path.join(projectRoot, expectedPackage.path, 'CHANGELOG.md')
    if (!(await pathExists(changelogPath))) {
      violations.push(`${expectedPackage.path}/CHANGELOG.md must exist before Release Please runs.`)
    }
  }
}

function validateWorkflowText(workflowText: string, violations: string[]) {
  const requiredSnippets = [
    'workflow_dispatch:',
    'dry_run:',
    'googleapis/release-please-action@v4',
    `config-file: ${CONFIG_PATH}`,
    `manifest-file: ${MANIFEST_PATH}`,
    'id-token: write',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
    'npm stage publish',
    'pnpm package-release:validate',
    'pnpm check',
    'pnpm build:packages',
    'github.event_name == \'push\'',
    'github.ref == \'refs/heads/main\'',
  ]

  for (const snippet of requiredSnippets) {
    if (!workflowText.includes(snippet)) {
      violations.push(`${WORKFLOW_PATH} must contain ${snippet}.`)
    }
  }

  if (workflowText.includes('NPM_TOKEN') || workflowText.includes('NODE_AUTH_TOKEN')) {
    violations.push(`${WORKFLOW_PATH} must not use npm token fallback authentication.`)
  }
  if (workflowText.includes('npm publish')) {
    violations.push(`${WORKFLOW_PATH} must use npm staged publishing, not direct npm publish.`)
  }
}

async function validateWorkflow(projectRoot: string, violations: string[]) {
  const workflowAbsolutePath = path.join(projectRoot, WORKFLOW_PATH)
  try {
    validateWorkflowText(await readFile(workflowAbsolutePath, 'utf8'), violations)
  } catch (error) {
    violations.push(`${WORKFLOW_PATH} must be readable: ${String(error)}`)
  }
}

export async function validatePackageReleaseFiles(
  projectRoot: string,
): Promise<PackageReleaseValidationResult> {
  const violations: string[] = []
  const [config, manifest] = await Promise.all([
    readJsonFile(projectRoot, CONFIG_PATH, violations),
    readJsonFile(projectRoot, MANIFEST_PATH, violations),
  ])

  validateReleasePleaseConfig(config, violations)
  validateReleasePleaseManifest(manifest, violations)
  await validatePackageMetadata(projectRoot, manifest, violations)
  await validateWorkflow(projectRoot, violations)

  return { violations }
}

async function main() {
  const result = await validatePackageReleaseFiles(process.cwd())

  if (result.violations.length === EMPTY_COUNT) {
    return
  }

  for (const violation of result.violations) {
    console.error(violation)
  }

  process.exitCode = FAILURE_EXIT_CODE
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = FAILURE_EXIT_CODE
  })
}
