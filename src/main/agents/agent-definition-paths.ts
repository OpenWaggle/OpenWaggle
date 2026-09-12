import os from 'node:os'
import path from 'node:path'
import type { AgentDefinitionScope } from '@shared/types/agent-definition'
import { isAgentDefinitionName } from './agent-definition-name'

export function agentDefinitionDirectory(input: {
  readonly scope: AgentDefinitionScope
  readonly projectPath: string
  readonly userHome?: string
}) {
  if (input.scope === 'project') return path.join(input.projectPath, '.openwaggle', 'agents')
  if (input.scope === 'portable-project') return path.join(input.projectPath, '.agents', 'agents')
  return path.join(input.userHome ?? os.homedir(), '.openwaggle', 'agents')
}

export function agentDefinitionPath(input: {
  readonly scope: AgentDefinitionScope
  readonly projectPath: string
  readonly name: string
  readonly userHome?: string
}) {
  if (!isAgentDefinitionName(input.name)) {
    throw new Error(`Invalid Agent definition name: ${JSON.stringify(input.name)}.`)
  }
  return path.join(agentDefinitionDirectory(input), `${input.name}.md`)
}
