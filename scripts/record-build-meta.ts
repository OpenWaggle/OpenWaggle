import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const GIT_REV_PARSE_MAX_BUFFER_BYTES = 4_000
const OUT_DIRECTORY = 'out'
const BUILD_META_FILENAME = 'build-meta.json'

export interface BuildMeta {
  readonly commit: string | null
  readonly builtAt: string
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolves the commit the working tree was built from, or null outside a git repository. */
export async function resolveHeadCommit(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      maxBuffer: GIT_REV_PARSE_MAX_BUFFER_BYTES,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export function parseBuildMeta(raw: string): BuildMeta | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObjectRecord(parsed)) return null
  const commit = parsed.commit
  const builtAt = parsed.builtAt
  return {
    commit: typeof commit === 'string' && commit.length > 0 ? commit : null,
    builtAt: typeof builtAt === 'string' ? builtAt : '',
  }
}

export async function readBuildMeta(outDirectory = OUT_DIRECTORY): Promise<BuildMeta | null> {
  try {
    return parseBuildMeta(await readFile(path.join(outDirectory, BUILD_META_FILENAME), 'utf8'))
  } catch {
    return null
  }
}

export async function writeBuildMeta(outDirectory = OUT_DIRECTORY): Promise<void> {
  const meta: BuildMeta = {
    commit: await resolveHeadCommit(),
    builtAt: new Date().toISOString(),
  }
  await mkdir(outDirectory, { recursive: true })
  await writeFile(
    path.join(outDirectory, BUILD_META_FILENAME),
    `${JSON.stringify(meta, null, JSON_INDENT_SPACES)}\n`,
    'utf8',
  )
}

const CLI_USAGE_MESSAGE =
  'Usage: tsx scripts/record-build-meta.ts [--verify]\n\n' +
  '  (default)  Record the current HEAD into out/build-meta.json after a build.\n' +
  '  --verify   Fail when out/ was not built from the current HEAD; run `pnpm test:e2e` to rebuild.'

const VERIFY_FLAG_ARGUMENT_INDEX = 2
const VERIFY_FLAG = '--verify'
const JSON_INDENT_SPACES = 2
const SHORT_SHA_LENGTH = 12

async function main() {
  if (process.argv[VERIFY_FLAG_ARGUMENT_INDEX] === VERIFY_FLAG) {
    const [meta, headCommit] = [await readBuildMeta(), await resolveHeadCommit()]
    if (meta === null) {
      console.error(
        'out/ has no build metadata, so quick E2E would test an app of unknown provenance. Run `pnpm test:e2e` to rebuild first.',
      )
      process.exitCode = 1
      return
    }
    if (meta.commit === null || meta.commit !== headCommit) {
      const builtAt = meta.commit === null ? 'an unknown commit' : meta.commit.slice(0, SHORT_SHA_LENGTH)
      const headAt = headCommit === null ? 'an unknown commit' : headCommit.slice(0, SHORT_SHA_LENGTH)
      console.error(
        `out/ was built at ${builtAt} but HEAD is ${headAt}. Quick E2E would test a stale build; run \`pnpm test:e2e\` to rebuild first.`,
      )
      process.exitCode = 1
      return
    }
    console.log('out/ build metadata is current.')
    return
  }

  await writeBuildMeta()
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`

if (isDirectInvocation) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
