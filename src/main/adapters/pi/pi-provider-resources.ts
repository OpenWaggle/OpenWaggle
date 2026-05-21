import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  CreateAgentSessionServicesOptions,
  ExtensionFactory,
  SettingsManager,
} from '@mariozechner/pi-coding-agent'
import { normalizeSkillId } from '@shared/utils/skill-id'
import { isPathInside } from '../../utils/paths'
import type { OpenWaggleMcpRuntimeContext } from './pi-mcp-config-service'

export interface PiRuntimeServicesOptions {
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly extensionFactories?: readonly ExtensionFactory[]
  readonly mcpRuntimeContext?: OpenWaggleMcpRuntimeContext | null
  readonly loadMcpAdapter?: boolean
}

type PiResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions['resourceLoaderOptions']
>
type PiSkillsOverride = NonNullable<PiResourceLoaderOptions['skillsOverride']>
type PiSkillsOverrideInput = Parameters<PiSkillsOverride>[0]

const OPENWAGGLE_SKILLS_ROOT_SEGMENTS = ['.openwaggle', 'skills'] as const
const OPENWAGGLE_EXTENSIONS_ROOT_SEGMENTS = ['.openwaggle', 'extensions'] as const
const OPENWAGGLE_PROMPTS_ROOT_SEGMENTS = ['.openwaggle', 'prompts'] as const
const OPENWAGGLE_THEMES_ROOT_SEGMENTS = ['.openwaggle', 'themes'] as const
const OPENWAGGLE_CATALOG_SKILL_ROOT_SEGMENTS = [
  OPENWAGGLE_SKILLS_ROOT_SEGMENTS,
  ['.agents', 'skills'] as const,
] as const

function getOpenWaggleSkillsRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_SKILLS_ROOT_SEGMENTS)
}

function getOpenWaggleExtensionsRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_EXTENSIONS_ROOT_SEGMENTS)
}

function getOpenWagglePromptsRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_PROMPTS_ROOT_SEGMENTS)
}

function getOpenWaggleThemesRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_THEMES_ROOT_SEGMENTS)
}

function includeExistingPath(filePath: string) {
  return existsSync(filePath) ? [filePath] : []
}

function getOpenWaggleCatalogSkillRoots(projectPath: string) {
  return OPENWAGGLE_CATALOG_SKILL_ROOT_SEGMENTS.map((segments) =>
    path.join(projectPath, ...segments),
  )
}

function getCatalogSkillIdForPiSkill(projectPath: string, skillFilePath: string) {
  const resolvedSkillFilePath = path.resolve(skillFilePath)
  for (const skillRoot of getOpenWaggleCatalogSkillRoots(projectPath)) {
    const resolvedSkillRoot = path.resolve(skillRoot)
    if (!isPathInside(resolvedSkillRoot, resolvedSkillFilePath)) {
      continue
    }

    const relativePath = path.relative(resolvedSkillRoot, resolvedSkillFilePath)
    const [skillRootSegment] = relativePath.split(path.sep)
    if (!skillRootSegment) {
      return null
    }

    return normalizeSkillId(path.basename(skillRootSegment, path.extname(skillRootSegment)))
  }

  return null
}

function filterDisabledCatalogSkills(
  projectPath: string,
  skillToggles: Readonly<Record<string, boolean>>,
  base: PiSkillsOverrideInput,
) {
  return {
    skills: base.skills.filter((skill) => {
      const skillId = getCatalogSkillIdForPiSkill(projectPath, skill.filePath)
      return skillId === null || skillToggles[skillId] !== false
    }),
    diagnostics: base.diagnostics,
  }
}
export function createOpenWagglePiResourceLoaderOptions(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
  settingsManager?: SettingsManager,
): PiResourceLoaderOptions {
  const skillToggles = options.skillToggles ?? {}
  return {
    additionalExtensionPaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleExtensionsRoot(projectPath)),
    additionalSkillPaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleSkillsRoot(projectPath)),
    additionalPromptTemplatePaths: settingsManager
      ? []
      : includeExistingPath(getOpenWagglePromptsRoot(projectPath)),
    additionalThemePaths: settingsManager
      ? []
      : includeExistingPath(getOpenWaggleThemesRoot(projectPath)),
    skillsOverride: (base) => filterDisabledCatalogSkills(projectPath, skillToggles, base),
    ...(options.extensionFactories ? { extensionFactories: [...options.extensionFactories] } : {}),
  }
}
