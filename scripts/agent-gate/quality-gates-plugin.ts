/**
 * Plugs the Fallow and React Doctor checks (scripts/agent-quality-gates, GATE-02 and REACT-07)
 * into the agent gate when that module is present, so one gate gives one verdict. The module is
 * loaded by path at run time and its findings are checked field by field, so the gate still
 * builds and runs in a checkout without it.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Finding } from './findings'
import type { GatePlugin, PluginResult } from './gate'

const QUALITY_GATES_MODULE = 'scripts/agent-quality-gates/gates.ts'

type Json = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One Fallow or React Doctor finding, `{ tool, rule, file, line, message }`, as a gate finding. */
export function qualityFinding(value: unknown): Finding | undefined {
  if (!isRecord(value)) return undefined
  const { tool, rule, file, line, message } = value
  if (typeof tool !== 'string' || typeof rule !== 'string' || typeof file !== 'string')
    return undefined
  return {
    file,
    ...(typeof line === 'number' ? { line } : {}),
    rule: `${tool.replace(' ', '/')}/${rule}`,
    id: tool === 'react-doctor' ? 'REACT-07' : 'GATE-02',
    message: typeof message === 'string' ? message : rule,
    severity: 'block',
  }
}

type QualityGateFindings = (input: Json) => Promise<unknown>

async function loadFindings(root: string): Promise<QualityGateFindings | undefined> {
  const file = path.join(root, QUALITY_GATES_MODULE)
  if (!existsSync(file)) return undefined
  const loaded: unknown = await import(pathToFileURL(file).href)
  const findings = isRecord(loaded) ? loaded['qualityGateFindings'] : undefined
  if (typeof findings !== 'function') return undefined
  return async (input) => {
    const result: unknown = await Reflect.apply(findings, undefined, [input])
    return result
  }
}

export const qualityGatesPlugin: GatePlugin = {
  name: 'fallow and react-doctor',
  async run(input): Promise<PluginResult> {
    const findings = await loadFindings(input.root)
    if (findings === undefined) return { findings: [], failures: [] }
    const result = await findings({ ...input })
    const list = Array.isArray(result) ? result : []
    return { findings: list.flatMap((item) => qualityFinding(item) ?? []), failures: [] }
  },
}
