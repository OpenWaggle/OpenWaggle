import { homedir } from 'node:os'
import path from 'node:path'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { isPathInside } from '../../utils/paths'

/** Longest skill description the prompt lists; the whole one stays in the skill's SKILL.md. */
export const SKILL_PROMPT_DESCRIPTION_LIMIT = 200

const ELLIPSIS = '…'

/**
 * Where the prompt says a skill file is: relative to the working directory for a skill inside it,
 * which is also the same text in every worktree of a project, `~/…` for one under the home
 * directory (Pi's read tool and shells expand `~`), and the absolute path otherwise.
 */
export function promptSkillLocation(filePath: string, cwd: string, home = homedir()) {
  const absolute = path.resolve(filePath)
  if (isPathInside(path.resolve(cwd), absolute)) {
    return path.relative(cwd, absolute).split(path.sep).join('/')
  }
  if (home && isPathInside(path.resolve(home), absolute)) {
    return `~/${path.relative(home, absolute).split(path.sep).join('/')}`
  }
  return filePath
}

/** The description, cut at a word before the limit when longer. */
export function promptSkillDescription(description: string) {
  const text = description.trim().replace(/\s+/g, ' ')
  if (text.length <= SKILL_PROMPT_DESCRIPTION_LIMIT) return text
  const cut = text.slice(0, SKILL_PROMPT_DESCRIPTION_LIMIT - ELLIPSIS.length)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}${ELLIPSIS}`
}

/**
 * Shortens the `<skills>` listing: relative or `~` locations and capped descriptions (C7 of the v1
 * performance research: absolute paths were a third of a 9k-token listing). It changes only the
 * prompt's copy; Pi still reads every skill, and expands `/skill:` commands, from its real path.
 */
export function skillPromptListingExtension(): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', (event) => {
      const options = event.systemPromptOptions
      options.skills = options.skills.map((skill) => ({
        ...skill,
        filePath: promptSkillLocation(skill.filePath, options.cwd),
        description: promptSkillDescription(skill.description),
      }))
      return undefined
    })
  }
}
