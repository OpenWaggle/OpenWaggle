import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cause, Effect, Exit, Layer, Option } from 'effect'
import { afterEach, beforeEach } from 'vitest'
import { createFilesystemMcpConfigurationService } from '../../adapters/mcp/config/filesystem-mcp-configuration-service'
import { createFilesystemMcpImportService } from '../../adapters/mcp/filesystem-mcp-import-service'
import {
  type McpConfigurationScopeInput,
  McpConfigurationService,
} from '../../ports/mcp-configuration-service'
import { McpImportService } from '../../ports/mcp-import-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import {
  McpServerRuntimeService,
  type McpServerScopeInput,
} from '../../ports/mcp-server-runtime-service'
import { WorkspaceProjectAuthorization } from '../../ports/workspace-project-authorization'

type Services =
  | McpConfigurationService
  | McpImportService
  | McpSecretVaultService
  | McpServerRuntimeService
  | WorkspaceProjectAuthorization

/** A home directory, Pi agent directory, and project in a temporary folder, with real services. */
export function createMcpOperationsHarness() {
  const runtimeCalls: {
    readonly operation: string
    readonly input: McpServerScopeInput | McpConfigurationScopeInput
  }[] = []
  const state = {
    root: '',
    homeDir: '',
    piAgentDir: '',
    projectPath: '',
    /** A managed worktree of the project, as a Session in worktree mode runs in. */
    worktreePath: '',
    /** Names of the secrets in the vault. */
    vaultSecrets: new Array<string>(),
    sourceFiles: new Map<string, string>(),
    runtimeCalls,
  }

  /** Stands in for Pi's MCP runtime: connected, and sign-in reports the page it could not open. */
  const runtime = McpServerRuntimeService.of({
    inspectServer: (input) =>
      Effect.sync(() => {
        state.runtimeCalls.push({ operation: 'inspect', input })
        return {
          name: input.name,
          state: 'connected' as const,
          tools: [{ name: 'search', exposure: 'codemode' as const, hasApp: false }],
        }
      }),
    getServerStatuses: (input) =>
      Effect.sync(() => {
        state.runtimeCalls.push({ operation: 'statuses', input })
        return [{ name: 'docs', source: 'not-checked' as const }]
      }),
    signIn: (input) =>
      Effect.sync(() => {
        state.runtimeCalls.push({ operation: 'sign-in', input })
        return { signedIn: false, authorizationUrl: 'https://auth.example/start' }
      }),
    signOut: (input) =>
      Effect.sync(() => {
        state.runtimeCalls.push({ operation: 'sign-out', input })
      }),
    getSessionMcpEnabled: () => Effect.succeed(true),
    setSessionMcpEnabled: () => Effect.void,
  })

  beforeEach(() => {
    state.root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-operations-'))
    state.homeDir = path.join(state.root, 'home')
    state.piAgentDir = path.join(state.homeDir, '.pi', 'agent')
    state.projectPath = path.join(state.root, 'project')
    state.worktreePath = path.join(state.root, 'worktrees', 'session-worktree')
    mkdirSync(state.projectPath, { recursive: true })
    mkdirSync(state.worktreePath, { recursive: true })
    state.sourceFiles = new Map()
    state.vaultSecrets = []
    state.runtimeCalls.length = 0
  })

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true })
  })

  function layer() {
    return Layer.mergeAll(
      Layer.succeed(
        McpConfigurationService,
        createFilesystemMcpConfigurationService({
          homeDir: state.homeDir,
          piAgentDir: state.piAgentDir,
        }),
      ),
      Layer.succeed(
        McpImportService,
        createFilesystemMcpImportService({
          homeDir: state.homeDir,
          piAgentDir: state.piAgentDir,
          platform: 'linux',
          readSourceText: (filePath) => Promise.resolve(state.sourceFiles.get(filePath)),
          now: () => new Date('2026-10-07T00:00:00Z'),
        }),
      ),
      Layer.succeed(McpServerRuntimeService, runtime),
      Layer.succeed(
        McpSecretVaultService,
        McpSecretVaultService.of({
          list: () =>
            Effect.succeed(
              state.vaultSecrets.map((name) => ({ name, createdAt: 1, updatedAt: 1 })),
            ),
          resolve: () => Effect.die('not read'),
          set: () => Effect.die('not written'),
          remove: () => Effect.die('not written'),
        }),
      ),
      // Only the harness project, and its Session's worktree, are known to OpenWaggle.
      Layer.succeed(
        WorkspaceProjectAuthorization,
        WorkspaceProjectAuthorization.of({
          authorize: (projectPath) =>
            projectPath === state.projectPath || projectPath === state.worktreePath
              ? Effect.succeed(projectPath)
              : Effect.fail(new Error('Project path is not authorized for workspace access.')),
          projectOfWorkspace: (workspacePath) =>
            Effect.succeed(
              workspacePath === state.worktreePath ? state.projectPath : workspacePath,
            ),
        }),
      ),
    )
  }

  return {
    state,
    piGlobal: () => path.join(state.piAgentDir, 'mcp.json'),
    owGlobal: () => path.join(state.homeDir, '.openwaggle', 'mcp.json'),
    owProject: () => path.join(state.projectPath, '.openwaggle', 'mcp.json'),
    writeJson(filePath: string, value: unknown) {
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(value, null, 2))
    },
    servers(filePath: string): Record<string, unknown> {
      const parsed: { mcpServers: Record<string, unknown> } = JSON.parse(
        readFileSync(filePath, 'utf8'),
      )
      return parsed.mcpServers
    },
    run<A, E>(effect: Effect.Effect<A, E, Services>) {
      return Effect.runPromise(Effect.provide(effect, layer()))
    },
    async failureMessage<A, E>(effect: Effect.Effect<A, E, Services>) {
      const exit = await Effect.runPromiseExit(Effect.provide(effect, layer()))
      if (Exit.isSuccess(exit)) throw new Error('Expected the operation to fail.')
      const error = Option.getOrUndefined(Cause.failureOption(exit.cause))
      return error instanceof Error ? error.message : String(error)
    },
  }
}
