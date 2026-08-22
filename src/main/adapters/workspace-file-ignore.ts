import fs from 'node:fs/promises'
import path from 'node:path'
import type { Options as FastGlobOptions } from 'fast-glob'
import ignore, { type Ignore } from 'ignore'

export const WORKSPACE_FILE_GLOB_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
]

interface GitignoreMatcher {
  readonly base: string
  readonly matcher: Ignore
}

async function gitignoreMatchers(
  projectRoot: string,
  glob: (source: string, options: FastGlobOptions) => Promise<string[]>,
) {
  const files = await glob('**/.gitignore', {
    cwd: projectRoot,
    ignore: WORKSPACE_FILE_GLOB_IGNORES,
    onlyFiles: true,
    followSymbolicLinks: false,
    unique: true,
    dot: true,
  })
  return Promise.all(
    files
      .map((file) => file.replaceAll('\\', '/'))
      .sort((left, right) => left.split('/').length - right.split('/').length)
      .map(
        async (file): Promise<GitignoreMatcher> => ({
          base: path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file),
          matcher: ignore().add(await fs.readFile(path.join(projectRoot, file), 'utf8')),
        }),
      ),
  )
}

function isIgnoredByMatchers(
  relativePath: string,
  directory: boolean,
  matchers: readonly GitignoreMatcher[],
) {
  let ignored = false
  for (const { base, matcher } of matchers) {
    if (base && relativePath !== base && !relativePath.startsWith(`${base}/`)) continue
    const relativeCandidate = base ? relativePath.slice(base.length + 1) : relativePath
    if (!relativeCandidate) continue
    const candidate = directory ? `${relativeCandidate}/` : relativeCandidate
    const result = matcher.test(candidate)
    if (result.ignored) ignored = true
    if (result.unignored) ignored = false
  }
  return ignored
}

function isGitignored(relativePath: string, matchers: readonly GitignoreMatcher[]) {
  const segments = relativePath.split('/')
  let ancestor = ''
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (!segment) continue
    ancestor = ancestor ? `${ancestor}/${segment}` : segment
    if (isIgnoredByMatchers(ancestor, true, matchers)) return true
  }
  return isIgnoredByMatchers(relativePath, false, matchers)
}

export async function filterGitignoredWorkspacePaths(
  projectRoot: string,
  paths: readonly string[],
  glob: (source: string, options: FastGlobOptions) => Promise<string[]>,
) {
  const matchers = await gitignoreMatchers(projectRoot, glob)
  return paths.filter((entry) => !isGitignored(entry, matchers))
}
