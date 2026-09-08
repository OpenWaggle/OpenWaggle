import { existsSync } from 'node:fs'
import path from 'node:path'
import type {
  CreateAgentSessionServicesOptions,
  ExtensionFactory,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { normalizeSkillId } from '@shared/utils/skill-id'
import { env } from '../../env'
import { isPathInside } from '../../utils/paths'
import type { OpenWaggleExtensionPiResourceRoot } from './openwaggle-pi-settings-resources'

export interface PiRuntimeServicesOptions {
  readonly skillToggles?: Readonly<Record<string, boolean>>
  readonly enabledOpenWaggleExtensionPackagePaths?: readonly string[]
  readonly enabledOpenWaggleExtensionResourceRoots?: readonly OpenWaggleExtensionPiResourceRoot[]
  readonly extensionFactories?: readonly ExtensionFactory[]
  readonly trustedExtensionFactories?: readonly ExtensionFactory[]
  readonly systemPromptAppendices?: readonly string[]
  readonly visualizationDirectory?: string
}

type PiResourceLoaderOptions = NonNullable<
  CreateAgentSessionServicesOptions['resourceLoaderOptions']
>
type PiSkillsOverride = NonNullable<PiResourceLoaderOptions['skillsOverride']>
type PiSkillsOverrideInput = Parameters<PiSkillsOverride>[0]

const OPENWAGGLE_SKILLS_ROOT_SEGMENTS = ['.openwaggle', 'skills'] as const
const OPENWAGGLE_PROMPTS_ROOT_SEGMENTS = ['.openwaggle', 'prompts'] as const
const OPENWAGGLE_THEMES_ROOT_SEGMENTS = ['.openwaggle', 'themes'] as const
const OPENWAGGLE_CATALOG_SKILL_ROOT_SEGMENTS = [
  OPENWAGGLE_SKILLS_ROOT_SEGMENTS,
  ['.agents', 'skills'] as const,
] as const

function getOpenWaggleSkillsRoot(projectPath: string) {
  return path.join(projectPath, ...OPENWAGGLE_SKILLS_ROOT_SEGMENTS)
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

function getEnabledOpenWaggleExtensionPackagePaths(packagePaths: readonly string[] = []) {
  return packagePaths.flatMap(includeExistingPath)
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

function disableExecutableExtensionsForAutomation() {
  return env.OPENWAGGLE_AUTOMATION === '1'
}

function systemPromptAppendices(options: PiRuntimeServicesOptions) {
  const appendices = [...(options.systemPromptAppendices ?? [])]
  if (options.visualizationDirectory) {
    appendices.unshift(
      [
        '## Inline visualization authoring',
        `The durable visualization directory for this session is ${JSON.stringify(options.visualizationDirectory)}.`,
        'When using the visualize skill, write its HTML fragment there and emit the absolute path in the documented visualize reference.',
      ].join('\n'),
    )
  }
  return appendices
}

function configuredExtensionFactories(
  options: PiRuntimeServicesOptions,
  disableExtensions: boolean,
) {
  return [
    ...(disableExtensions ? [] : (options.extensionFactories ?? [])),
    ...(options.trustedExtensionFactories ?? []),
  ]
}

function configuredResourcePaths(
  projectPath: string,
  options: PiRuntimeServicesOptions,
  settingsManager: SettingsManager | undefined,
  builtInSkillPaths: readonly string[],
  disableExtensions: boolean,
) {
  if (settingsManager) {
    return {
      additionalExtensionPaths: [],
      additionalSkillPaths: [...builtInSkillPaths],
      additionalPromptTemplatePaths: [],
      additionalThemePaths: [],
    }
  }
  return {
    additionalExtensionPaths: disableExtensions
      ? []
      : getEnabledOpenWaggleExtensionPackagePaths(options.enabledOpenWaggleExtensionPackagePaths),
    additionalSkillPaths: [
      ...builtInSkillPaths,
      ...includeExistingPath(getOpenWaggleSkillsRoot(projectPath)),
    ],
    additionalPromptTemplatePaths: includeExistingPath(getOpenWagglePromptsRoot(projectPath)),
    additionalThemePaths: includeExistingPath(getOpenWaggleThemesRoot(projectPath)),
  }
}

export function createOpenWaggleGlobalPiResourceLoaderOptions(): PiResourceLoaderOptions {
  return disableExecutableExtensionsForAutomation() ? { noExtensions: true } : {}
}

export function createOpenWagglePiResourceLoaderOptions(
  projectPath: string,
  options: PiRuntimeServicesOptions = {},
  settingsManager?: SettingsManager,
  builtInSkillPaths: readonly string[] = [],
): PiResourceLoaderOptions {
  const skillToggles = options.skillToggles ?? {}
  const disableExtensions = disableExecutableExtensionsForAutomation()
  const appendSystemPrompt = systemPromptAppendices(options)
  const extensionFactories = configuredExtensionFactories(options, disableExtensions)
  return {
    ...configuredResourcePaths(
      projectPath,
      options,
      settingsManager,
      builtInSkillPaths,
      disableExtensions,
    ),
    skillsOverride: (base) => filterDisabledCatalogSkills(projectPath, skillToggles, base),
    ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
    ...(disableExtensions ? { noExtensions: true } : {}),
    ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
  }
}
