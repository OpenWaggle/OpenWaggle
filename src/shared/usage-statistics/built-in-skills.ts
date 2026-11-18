/**
 * The skills OpenWaggle ships (src/main/adapters/pi/pi-visualize-skill.ts installs them under
 * Pi's agent directory as `openwaggle-built-in-skills`). Usage statistics name a skill only when
 * it is one of these; any other skill is reported as `custom`.
 *
 * The single source of the list: scripts/generate-usage-statistics-catalog.ts writes it into
 * ./catalog.generated.ts, which the app and the statistics endpoint map against. Dependency-free
 * and alias-free, like ./contract.ts.
 */
export const USAGE_STATISTICS_BUILT_IN_SKILLS = ['visualize'] as const
