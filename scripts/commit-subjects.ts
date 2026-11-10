import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

const COMMIT_BODY_FIELD_OFFSET = 3
const COMMIT_FIELD_COUNT = 4
const COMMIT_PARENTS_FIELD_OFFSET = 1
const COMMIT_SUBJECT_FIELD_OFFSET = 2
const GIT_LOG_MAX_BUFFER_BYTES = 10 * 1024 * 1024

export interface CommitSubject {
  readonly body: string
  readonly changedPaths: readonly string[]
  readonly hash: string
  readonly parentHashes: readonly string[]
  readonly subject: string
}

/** The commits in `from..to`, newest first, each with the paths it changed relative to its first parent. */
export async function readCommitSubjects(cwd: string, from: string, to: string) {
  const { stdout } = await execFile(
    'git',
    ['log', '--format=%H%x00%P%x00%s%x00%b%x00', `${from}..${to}`],
    { cwd, maxBuffer: GIT_LOG_MAX_BUFFER_BYTES },
  )
  const fields = stdout.split('\0')
  const commits: CommitSubject[] = []

  for (
    let index = 0;
    index + COMMIT_BODY_FIELD_OFFSET < fields.length;
    index += COMMIT_FIELD_COUNT
  ) {
    const hash = fields[index]
    const parents = fields[index + COMMIT_PARENTS_FIELD_OFFSET]
    const subject = fields[index + COMMIT_SUBJECT_FIELD_OFFSET]
    const body = fields[index + COMMIT_BODY_FIELD_OFFSET]

    if (
      hash === undefined ||
      parents === undefined ||
      subject === undefined ||
      body === undefined ||
      hash.length === 0
    ) {
      continue
    }

    const normalizedHash = hash.trim()
    const parentHashes = parents
      .trim()
      .split(' ')
      .filter((parentHash) => parentHash.length > 0)
    const firstParent = parentHashes[0]
    const changedPathsArgs =
      parentHashes.length > 1 && firstParent !== undefined
        ? ['diff', '--no-renames', '--name-only', '-z', firstParent, normalizedHash]
        : [
            'diff-tree',
            '--no-commit-id',
            '--no-renames',
            '--name-only',
            '--root',
            '-r',
            '-z',
            normalizedHash,
          ]
    const { stdout: changedPathsOutput } = await execFile('git', changedPathsArgs, {
      cwd,
      maxBuffer: GIT_LOG_MAX_BUFFER_BYTES,
    })

    commits.push({
      body,
      changedPaths: [
        ...new Set(changedPathsOutput.split('\0').filter((entry) => entry.length > 0)),
      ],
      hash: normalizedHash,
      parentHashes,
      subject,
    })
  }

  return commits
}
