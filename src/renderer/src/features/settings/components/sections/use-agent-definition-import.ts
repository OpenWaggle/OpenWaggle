import type {
  AgentDefinitionImportSource,
  AgentDefinitionScope,
} from '@shared/types/agent-definition'
import type { AgentDefinitionImportPlan } from '@shared/types/agent-definition-management'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'

export const IMPORT_SOURCES = [
  'auto',
  'openwaggle',
  'codex',
  'claude-code',
  'cursor',
  'gemini-cli',
  'github-copilot',
  'opencode',
] as const
export const IMPORT_SCOPES = ['project', 'portable-project', 'user'] as const
export type ImportSource = AgentDefinitionImportSource | 'auto'

export const SOURCE_LABELS: Record<ImportSource, string> = {
  auto: 'Detect automatically',
  openwaggle: 'OpenWaggle',
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  'gemini-cli': 'Gemini CLI',
  'github-copilot': 'GitHub Copilot',
  opencode: 'OpenCode',
}

export function useAgentDefinitionImport(input: {
  readonly projectPath: string
  readonly onClose: () => void
  readonly onImported: () => Promise<void>
}) {
  const [sourcePath, setSourcePath] = useState('')
  const [sourceTool, setSourceTool] = useState<ImportSource>('auto')
  const [sourceName, setSourceName] = useState('')
  const [targetScope, setTargetScope] = useState<AgentDefinitionScope>('project')
  const [plan, setPlan] = useState<AgentDefinitionImportPlan | null>(null)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function invalidatePlan() {
    setPlan(null)
    setReplaceExisting(false)
  }

  async function chooseSource() {
    const selected = await api.selectAgentDefinitionSource()
    if (!selected) return
    setSourcePath(selected)
    invalidatePlan()
  }

  async function review() {
    if (!sourcePath.trim()) throw new Error('Choose an Agent definition source file.')
    const outcome = await api.manageAgentDefinitions({
      operation: 'import-plan',
      projectPath: input.projectPath,
      sourcePath: sourcePath.trim(),
      sourceTool,
      ...(sourceName.trim() ? { sourceName: sourceName.trim() } : {}),
      targetScope,
    })
    if (outcome.operation !== 'import-plan') throw new Error('Unexpected import response.')
    setPlan(outcome.plan)
    setReplaceExisting(false)
  }

  async function apply() {
    if (!plan) return
    await api.manageAgentDefinitions({
      operation: 'import-apply',
      projectPath: input.projectPath,
      sourcePath: plan.sourcePath,
      sourceTool: plan.sourceTool,
      ...(plan.sourceName ? { sourceName: plan.sourceName } : {}),
      targetScope: plan.targetScope,
      expectedSourceDigest: plan.sourceDigest,
      replaceExisting,
      ...(plan.existingContentDigest ? { expectedContentDigest: plan.existingContentDigest } : {}),
    })
    await input.onImported()
    input.onClose()
  }

  async function run(action: 'choose-source' | 'submit') {
    setWorking(true)
    setError(null)
    try {
      if (action === 'choose-source') {
        await chooseSource()
        return
      }
      if (plan) {
        await apply()
        return
      }
      await review()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setWorking(false)
    }
  }

  return {
    sourcePath,
    sourceTool,
    sourceName,
    targetScope,
    plan,
    replaceExisting,
    working,
    error,
    needsReplacement: plan?.status === 'conflict',
    canApply: Boolean(
      plan?.document &&
        plan.status !== 'blocked' &&
        (plan.status !== 'conflict' || replaceExisting),
    ),
    setSourcePath,
    setSourceTool,
    setSourceName,
    setTargetScope,
    setReplaceExisting,
    invalidatePlan,
    chooseSource: () => run('choose-source'),
    submit: () => run('submit'),
  }
}
