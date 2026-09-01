import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import lucideRuntime from 'lucide/dist/umd/lucide.min.js?raw'
import baseStyles from '../../inline-visualization-assets/base.css.raw?raw'
import renderScriptSource from './visualize-skill/render.py.raw?raw'
import visualizeSkillSource from './visualize-skill/SKILL.md.raw?raw'

const BUILT_IN_SKILLS_DIRECTORY = 'openwaggle-built-in-skills'
const PRIVATE_FILE_MODE = 0o600
const pendingSkillPreparation = new Map<string, Promise<string>>()

async function ensureOwnedDirectory(directory: string) {
  try {
    await fs.mkdir(directory)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  const stats = await fs.lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Invalid built-in skill directory: ${directory}`)
  }
}

async function writeResourceIfChanged(filePath: string, source: string) {
  const currentStats = await fs.lstat(filePath).catch(() => null)
  const currentSource = currentStats?.isFile()
    ? await fs.readFile(filePath, 'utf8').catch(() => null)
    : null
  if (currentSource === source) {
    await fs.chmod(filePath, PRIVATE_FILE_MODE)
    return
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}`,
  )
  try {
    await fs.writeFile(temporaryPath, source, {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    })
    await fs.rename(temporaryPath, filePath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

async function preparePiVisualizeSkill(agentDir: string) {
  await fs.mkdir(agentDir, { recursive: true })
  const agentDirectoryStats = await fs.lstat(agentDir)
  if (agentDirectoryStats.isSymbolicLink() || !agentDirectoryStats.isDirectory()) {
    throw new Error(`Invalid Pi agent directory: ${agentDir}`)
  }
  const realAgentDir = await fs.realpath(agentDir)
  const builtInSkillsDirectory = path.join(realAgentDir, BUILT_IN_SKILLS_DIRECTORY)
  const skillDirectory = path.join(builtInSkillsDirectory, 'visualize')
  const scriptsDirectory = path.join(skillDirectory, 'scripts')
  const assetsDirectory = path.join(skillDirectory, 'assets')
  await ensureOwnedDirectory(builtInSkillsDirectory)
  await ensureOwnedDirectory(skillDirectory)
  await ensureOwnedDirectory(scriptsDirectory)
  await ensureOwnedDirectory(assetsDirectory)
  const skillPath = path.join(skillDirectory, 'SKILL.md')
  await Promise.all([
    writeResourceIfChanged(skillPath, visualizeSkillSource),
    writeResourceIfChanged(path.join(scriptsDirectory, 'render.py'), renderScriptSource),
    writeResourceIfChanged(path.join(assetsDirectory, 'base.css'), baseStyles),
    writeResourceIfChanged(path.join(assetsDirectory, 'lucide.js'), lucideRuntime),
  ])

  return skillPath
}

export function ensurePiVisualizeSkill(agentDir: string) {
  const normalizedAgentDir = path.resolve(agentDir)
  const pending = pendingSkillPreparation.get(normalizedAgentDir)
  if (pending) return pending
  const preparation = preparePiVisualizeSkill(normalizedAgentDir).finally(() => {
    if (pendingSkillPreparation.get(normalizedAgentDir) === preparation) {
      pendingSkillPreparation.delete(normalizedAgentDir)
    }
  })
  pendingSkillPreparation.set(normalizedAgentDir, preparation)
  return preparation
}
