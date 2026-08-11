import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { match } from '@diegogbrisa/ts-match'
import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '@shared/constants/mcp'
import type { McpDoctorResult } from '@shared/types/mcp'
import { Effect } from 'effect'

function isExecutable(filePath: string): Effect.Effect<boolean> {
  return Effect.tryPromise(() => access(filePath, constants.X_OK)).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  )
}

function sandboxCheck(): Effect.Effect<McpDoctorResult['checks'][number]> {
  return match(process.platform)
    .with('darwin', () =>
      isExecutable('/usr/bin/sandbox-exec').pipe(
        Effect.map((available): McpDoctorResult['checks'][number] =>
          available
            ? {
                id: 'stdio-sandbox',
                status: 'pass',
                message: 'macOS Seatbelt sandbox is available.',
              }
            : {
                id: 'stdio-sandbox',
                status: 'fail',
                message: 'macOS Seatbelt sandbox is unavailable.',
                action: 'Use remote MCP or explicitly approve unsandboxed stdio execution.',
              },
        ),
      ),
    )
    .with('linux', () =>
      Effect.succeed<McpDoctorResult['checks'][number]>({
        id: 'stdio-sandbox',
        status: 'warning',
        message:
          'Linux stdio MCP requires bubblewrap; availability is verified at connection time.',
        action: 'Install bwrap before enabling stdio MCP servers.',
      }),
    )
    .with('win32', () =>
      Effect.succeed<McpDoctorResult['checks'][number]>({
        id: 'stdio-sandbox',
        status: 'warning',
        message:
          'Windows has no OS-level sandbox for local (stdio) MCP servers yet (see ADR-0014). Local servers stay blocked unless you explicitly approve unsandboxed execution.',
        action:
          'Prefer remote MCP servers (no sandbox needed), or explicitly approve unsandboxed execution to accept full user-level access.',
      }),
    )
    .otherwise(() =>
      Effect.succeed<McpDoctorResult['checks'][number]>({
        id: 'stdio-sandbox',
        status: 'warning',
        message: 'No first-party stdio sandbox is configured for this platform.',
        action: 'Use remote MCP or explicitly approve unsandboxed execution.',
      }),
    )
}

export function runMcpRuntimeDoctor(): Effect.Effect<McpDoctorResult> {
  return sandboxCheck().pipe(
    Effect.map((sandbox) => {
      const checks: McpDoctorResult['checks'][number][] = [
        {
          id: 'protocol-matrix',
          status: 'pass',
          message: `Automatic MCP negotiation supports ${MCP_SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
        },
        sandbox,
      ]
      return { ok: checks.every((check) => check.status !== 'fail'), checks }
    }),
  )
}
