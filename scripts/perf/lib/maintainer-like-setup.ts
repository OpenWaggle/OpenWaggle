import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createGitProject } from './perf-profile'

/**
 * A setup like the maintainer's, for the "maintainer-like" prefix gate: this repository's own
 * AGENTS.md and project skills as of the v1 baseline commit, sixteen user-global skills and a
 * home AGENTS.md of the same sizes as the maintainer's (synthetic text, not their content).
 */
export const BASELINE_COMMIT = '77b9814b5'
const USER_GLOBAL_SKILLS = 16
const USER_SKILL_DESCRIPTION_CHARS = 380
const HOME_AGENTS_CHARS = 570
const FILLER =
  'Use this skill when the task involves the matching internal service, its tickets, documents or dashboards. '

function gitShow(repository: string, file: string) {
  return execFileSync('git', ['show', `${BASELINE_COMMIT}:${file}`], { cwd: repository, encoding: 'utf8' })
}

function sized(text: string, characters: number) {
  return text.repeat(Math.ceil(characters / text.length)).slice(0, characters)
}

/** A project with the baseline's AGENTS.md and `.agents/skills/<id>/SKILL.md` files. */
export async function createMaintainerLikeProject(projectPath: string, repository: string) {
  await createGitProject(projectPath)
  await writeFile(path.join(projectPath, 'AGENTS.md'), gitShow(repository, 'AGENTS.md'))
  const skillFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', BASELINE_COMMIT, '.agents/skills'], {
    cwd: repository,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file.endsWith('/SKILL.md'))
  for (const file of skillFiles) {
    await mkdir(path.join(projectPath, path.dirname(file)), { recursive: true })
    await writeFile(path.join(projectPath, file), gitShow(repository, file))
  }
  return { skills: skillFiles.length }
}

/** User-global skills under `~/.agents/skills` and a `~/AGENTS.md`, sized like the maintainer's. */
export async function writeMaintainerLikeHome(home: string) {
  for (let index = 0; index < USER_GLOBAL_SKILLS; index += 1) {
    const id = `team-tool-${String(index + 1)}`
    const directory = path.join(home, '.agents', 'skills', id)
    await mkdir(directory, { recursive: true })
    const description = sized(FILLER, USER_SKILL_DESCRIPTION_CHARS)
    await writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${id}\n\nInstructions for ${id}.\n`,
    )
  }
  await writeFile(
    path.join(home, 'AGENTS.md'),
    `## Company guidelines\n\n${sized('Follow the company guidelines for this language and run the hooks before pushing. ', HOME_AGENTS_CHARS)}\n`,
  )
}
