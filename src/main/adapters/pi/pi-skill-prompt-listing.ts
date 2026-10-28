import { homedir } from 'node:os'
import path from 'node:path'
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { isPathInside } from '../../utils/paths'

/** Longest skill description the prompt lists; the whole one stays in the skill's SKILL.md. */
export const SKILL_PROMPT_DESCRIPTION_LIMIT = 160

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

/** Shortest part of a skill's opening kept when its trigger sentence needs the room. */
const SKILL_PROMPT_MIN_LEAD = 72

/**
 * Where a description says when to use the skill ("Use when…", "Use this skill for…", "Triggers
 * on…"). That clause is what the model matches a request against, so it survives the cap.
 */
const SKILL_TRIGGER_PATTERN =
  /(?:^|[.;:!?]\s+|\s[-–—]\s+)((?:Use|Load|Invoke|Apply|Run)\b[^.]*?\b(?:when|whenever|for|to|if|after|before|while)\b|Triggers?\b|Must always apply\b)/iu

/** `text` cut at a word so it fits `limit` with its ellipsis. */
function cutAtWord(text: string, limit: number) {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - ELLIPSIS.length)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.]+$/, '')}${ELLIPSIS}`
}

/**
 * The description within the limit. A long one keeps its trigger sentence ("Use when…") whole when
 * it can, and shortens the opening before it instead: descriptions often spend their first
 * sentence on what the skill is and only then say when to use it, which a plain cut at the limit
 * would drop.
 */
export function promptSkillDescription(description: string) {
  const text = description.trim().replace(/\s+/g, ' ')
  if (text.length <= SKILL_PROMPT_DESCRIPTION_LIMIT) return text
  const trigger = SKILL_TRIGGER_PATTERN.exec(text)
  const triggerStart = trigger ? trigger.index + trigger[0].length - (trigger[1]?.length ?? 0) : -1
  if (triggerStart <= 0) return cutAtWord(text, SKILL_PROMPT_DESCRIPTION_LIMIT)
  const lead = text.slice(0, triggerStart).trim()
  const rest = text.slice(triggerStart).trim()
  const leadBudget = Math.max(
    SKILL_PROMPT_MIN_LEAD,
    SKILL_PROMPT_DESCRIPTION_LIMIT - rest.length - 1,
  )
  const shortLead = cutAtWord(lead, leadBudget)
  return cutAtWord(`${shortLead} ${rest}`, SKILL_PROMPT_DESCRIPTION_LIMIT)
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
