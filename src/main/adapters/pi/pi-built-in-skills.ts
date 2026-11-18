/**
 * Where and under which names OpenWaggle installs its own skills in Pi's agent directory.
 * pi-visualize-skill.ts writes them; pi-usage-statistics.ts recognizes them, and their names must
 * equal `USAGE_STATISTICS_BUILT_IN_SKILLS` (src/shared/usage-statistics/built-in-skills.ts).
 */
export const OPENWAGGLE_BUILT_IN_SKILLS_DIRECTORY = 'openwaggle-built-in-skills'
/** The visualize skill's directory name, which is also its name in SKILL.md. */
export const VISUALIZE_SKILL_NAME = 'visualize'
