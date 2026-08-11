import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { match } from '@diegogbrisa/ts-match'
import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '@shared/constants/mcp'
import type { McpDoctorResult } from '@shared/types/mcp'

async function isExecutable(filePath: string) {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function sandboxCheck(): Promise<McpDoctorResult['checks'][number]> {
  return match(process.platform)
    .with('darwin', async () =>
      (await isExecutable('/usr/bin/sandbox-exec'))
        ? { id: 'stdio-sandbox', status: 'pass', message: 'macOS Seatbelt sandbox is available.' }
        : {
            id: 'stdio-sandbox',
            status: 'fail',
            message: 'macOS Seatbelt sandbox is unavailable.',
            action: 'Use remote MCP or explicitly approve unsandboxed stdio execution.',
          },
    )
    .with('linux', () => ({
      id: 'stdio-sandbox',
      status: 'warning',
      message: 'Linux stdio MCP requires bubblewrap; availability is verified at connection time.',
      action: 'Install bwrap before enabling stdio MCP servers.',
    }))
    .otherwise(() => ({
      id: 'stdio-sandbox',
      status: 'warning',
      message: 'No first-party stdio sandbox is configured for this platform.',
      action: 'Use remote MCP or explicitly approve unsandboxed execution.',
    }))
}

export async function runMcpRuntimeDoctor(): Promise<McpDoctorResult> {
  const checks: McpDoctorResult['checks'][number][] = [
    {
      id: 'protocol-matrix',
      status: 'pass',
      message: `Automatic MCP negotiation supports ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
    },
    await sandboxCheck(),
  ]
  return { ok: checks.every((check) => check.status !== 'fail'), checks }
}
