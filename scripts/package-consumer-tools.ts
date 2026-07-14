import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/'
const INSTALL_MODE = 'install'
const VERIFY_MODE = 'verify'
const MODE_ARGUMENT_INDEX = 2
const FLAG_ARGUMENT_START_INDEX = 3
const EXACT_PACK_RESULT_COUNT = 1
const TOOL_ROOT_FLAG = '--tool-root'
const GITHUB_PATH_FLAG = '--github-path'
const PACKAGE_TOOLS = [
  {
    name: 'npm',
    spec: 'npm@11.18.0',
    version: '11.18.0',
    integrity: 'sha512-T67M4L5wNm0cZ7EBLErcEkY1SmzEW/WJ+SADBzsFUY1UdAPfFHXFQtZ6SEXiK0+vzXysCvAsepbMaBTwnrAD+w==',
  },
  {
    name: 'yarn',
    spec: '@yarnpkg/cli-dist@4.17.1',
    version: '4.17.1',
    integrity: 'sha512-2tiSQuJNl/L3QwTdrq6lKWDpkcnp9MGvCT/rIldHcbu3SWfnLdmehvt3eulX1hT7FFt1Gjfq3CesF+kvhFip6g==',
  },
] as const
const EXISTING_TOOLS = [
  { name: 'pnpm', version: '11.6.0' },
  { name: 'bun', version: '1.3.14' },
] as const

type CommandRunner = (command: string, args: readonly string[]) => Promise<string>

type InstallInput = {
  readonly toolRoot: string
  readonly githubPath: string
}

type InstallDependencies = {
  readonly runCommand?: CommandRunner
  readonly appendSearchPath?: (filePath: string, contents: string) => Promise<void>
  readonly prepareDirectory?: (directoryPath: string) => Promise<void>
  readonly verifyDownloadedPackage?: (filePath: string, integrity: string) => Promise<void>
  readonly writeUserConfig?: (filePath: string, contents: string) => Promise<void>
}

type VerifyDependencies = {
  readonly runCommand?: CommandRunner
  readonly resolveExecutable?: (name: string) => Promise<string | undefined>
}

function runCommand(command: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${String(code)}: ${stderr.trim()}`))
    })
  })
}

async function resolveExecutable(name: string) {
  const pathEntries = process.env['PATH']?.split(delimiter) ?? []
  for (const pathEntry of pathEntries) {
    const candidate = join(pathEntry, name)
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue searching PATH.
    }
  }
  return undefined
}

function packedTarballPath(packOutput: string, downloadDirectory: string) {
  const parsed: unknown = JSON.parse(packOutput)
  if (!Array.isArray(parsed) || parsed.length !== EXACT_PACK_RESULT_COUNT) {
    throw new Error('npm pack must return exactly one package result.')
  }
  const results = parsed.map((item: unknown) => item)
  const result = results[0]
  if (typeof result !== 'object' || result === null) {
    throw new Error('npm pack returned an invalid package result.')
  }
  const filename = 'filename' in result ? result.filename : undefined
  if (typeof filename !== 'string' || filename.length === 0 || basename(filename) !== filename) {
    throw new Error('npm pack returned an invalid tarball filename.')
  }
  return join(downloadDirectory, filename)
}

export async function verifyDownloadedPackageIntegrity(
  filePath: string,
  expectedIntegrity: string,
) {
  const digest = createHash('sha512').update(await readFile(filePath)).digest('base64')
  const actualIntegrity = `sha512-${digest}`
  if (actualIntegrity !== expectedIntegrity) {
    throw new Error(`${basename(filePath)} integrity mismatch: ${actualIntegrity}`)
  }
}

export async function installPackageConsumerTools(
  input: InstallInput,
  dependencies: InstallDependencies = {},
) {
  const execute = dependencies.runCommand ?? runCommand
  const appendSearchPath = dependencies.appendSearchPath ?? appendFile
  const prepareDirectory = dependencies.prepareDirectory ?? ((directoryPath) => mkdir(directoryPath, { recursive: true }))
  const verifyDownloadedPackage = dependencies.verifyDownloadedPackage ?? verifyDownloadedPackageIntegrity
  const writeUserConfig = dependencies.writeUserConfig ?? writeFile
  const userConfigPath = join(input.toolRoot, 'empty.npmrc')
  const downloadDirectory = join(input.toolRoot, 'downloads')
  await prepareDirectory(input.toolRoot)
  await prepareDirectory(downloadDirectory)
  await writeUserConfig(userConfigPath, '')

  const tarballPaths: string[] = []
  for (const tool of PACKAGE_TOOLS) {
    const packOutput = await execute('npm', [
      'pack',
      tool.spec,
      '--json',
      '--ignore-scripts',
      `--pack-destination=${downloadDirectory}`,
      `--registry=${OFFICIAL_NPM_REGISTRY}`,
      `--userconfig=${userConfigPath}`,
    ])
    const tarballPath = packedTarballPath(packOutput, downloadDirectory)
    await verifyDownloadedPackage(tarballPath, tool.integrity)
    tarballPaths.push(tarballPath)
  }

  await execute('npm', [
    'install',
    '--global',
    '--ignore-scripts',
    `--prefix=${input.toolRoot}`,
    `--registry=${OFFICIAL_NPM_REGISTRY}`,
    `--userconfig=${userConfigPath}`,
    ...tarballPaths,
  ])
  await appendSearchPath(input.githubPath, `${join(input.toolRoot, 'bin')}\n`)
}

export async function verifyPackageConsumerTools(
  toolRoot: string,
  dependencies: VerifyDependencies = {},
) {
  const execute = dependencies.runCommand ?? runCommand
  const findExecutable = dependencies.resolveExecutable ?? resolveExecutable
  for (const tool of [...PACKAGE_TOOLS, ...EXISTING_TOOLS]) {
    const executable = await findExecutable(tool.name)
    if (executable === undefined) throw new Error(`${tool.name} is not available on PATH.`)
    if (tool.name === 'npm' || tool.name === 'yarn') {
      const expectedExecutable = join(toolRoot, 'bin', tool.name)
      if (executable !== expectedExecutable) {
        throw new Error(`${tool.name} resolved from ${executable}, expected ${expectedExecutable}.`)
      }
    }
    const actualVersion = await execute(executable, ['--version'])
    if (actualVersion !== tool.version) {
      throw new Error(`${tool.name} version mismatch: ${actualVersion} != ${tool.version}`)
    }
  }
}

function readFlag(args: readonly string[], flag: string) {
  const index = args.indexOf(flag)
  const value = index === -1 ? undefined : args[index + 1]
  if (value === undefined || value.trim().length === 0) throw new Error(`Missing ${flag}.`)
  return value
}

async function main() {
  const mode = process.argv[MODE_ARGUMENT_INDEX]
  const args = process.argv.slice(FLAG_ARGUMENT_START_INDEX)
  const toolRoot = readFlag(args, TOOL_ROOT_FLAG)
  if (mode === INSTALL_MODE) {
    await installPackageConsumerTools({
      toolRoot,
      githubPath: readFlag(args, GITHUB_PATH_FLAG),
    })
    return
  }
  if (mode === VERIFY_MODE) {
    await verifyPackageConsumerTools(toolRoot)
    return
  }
  throw new Error(`Usage: package-consumer-tools.ts <${INSTALL_MODE}|${VERIFY_MODE}> ${TOOL_ROOT_FLAG} <path> [${GITHUB_PATH_FLAG} <path>]`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
