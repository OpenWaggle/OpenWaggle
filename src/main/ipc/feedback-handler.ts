import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { BASE_TEN } from '@shared/constants/math'
import { BYTES_PER_KIBIBYTE, FEEDBACK } from '@shared/constants/resource-limits'
import type { DiagnosticsInfo, FeedbackPayload, FeedbackSubmitResult } from '@shared/types/feedback'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { getGhCliEnv } from '../env'
import { createLogger, getLogFilePath } from '../logger'
import { redactSensitiveText } from '../utils/redact'
import { typedHandle } from './typed-ipc'

const logger = createLogger('ipc:feedback')

const FEEDBACK_REPO = 'OpenWaggle/OpenWaggle'

function execFilePromise(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: BASE_TEN * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE, ...options },
      (error, stdout, stderr) => {
        if (error) {
          // Attach stderr to the error for better diagnostics
          const enriched = new Error(stderr || error.message)
          enriched.cause = error
          reject(enriched)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

function humanOsName() {
  const platform = process.platform
  if (platform === 'darwin') return `macOS ${os.release()}`
  if (platform === 'win32') return `Windows ${os.release()}`
  if (platform === 'linux') return `Linux ${os.release()}`
  return `${platform} ${os.release()}`
}

function collectDiagnostics(): DiagnosticsInfo {
  return {
    os: humanOsName(),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    arch: process.arch,
  }
}

async function readRecentLogs(lineCount: number) {
  const logPath = getLogFilePath()
  if (!logPath) return ''

  try {
    const content = await readFile(logPath, 'utf8')
    const lines = content.split('\n')
    const recent = lines.slice(-lineCount).join('\n')
    return redactSensitiveText(recent)
  } catch {
    return ''
  }
}

function buildDescriptionSection(payload: FeedbackPayload) {
  return `## Description\n\n${payload.description || '_No description provided._'}`
}

function buildSystemInfoSection(payload: FeedbackPayload) {
  if (!payload.includeSystemInfo) return undefined

  const info = collectDiagnostics()
  return [
    '## System Info',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| OS | ${info.os} |`,
    `| App Version | ${info.appVersion} |`,
    `| Electron | ${info.electronVersion} |`,
    `| Node.js | ${info.nodeVersion} |`,
    `| Arch | ${info.arch} |`,
  ].join('\n')
}

function buildModelInfoSection(payload: FeedbackPayload) {
  if (!payload.includeModelInfo || !(payload.activeModel ?? payload.activeProvider)) {
    return undefined
  }

  const modelLines = ['## Model Info', '']
  if (payload.activeProvider) modelLines.push(`- **Provider:** ${payload.activeProvider}`)
  if (payload.activeModel) modelLines.push(`- **Model:** ${payload.activeModel}`)
  return modelLines.join('\n')
}

function buildErrorContextSection(payload: FeedbackPayload) {
  if (!payload.includeErrorContext || !payload.lastErrorContext) return undefined

  const ctx = payload.lastErrorContext
  const errorLines = [
    '## Error Context',
    '',
    `- **Code:** \`${ctx.code}\``,
    `- **Message:** ${ctx.userMessage}`,
  ]
  if (ctx.suggestion) errorLines.push(`- **Suggestion:** ${ctx.suggestion}`)
  errorLines.push(
    '',
    '<details><summary>Raw error</summary>',
    '',
    '```',
    ctx.message,
    '```',
    '',
    '</details>',
  )
  return errorLines.join('\n')
}

function buildLastMessageSection(payload: FeedbackPayload) {
  if (!payload.includeLastMessage || !payload.lastUserMessage) return undefined

  return [
    '## Last User Message',
    '',
    '<details><summary>Message content</summary>',
    '',
    '```',
    payload.lastUserMessage,
    '```',
    '',
    '</details>',
  ].join('\n')
}

async function buildLogsSection(payload: FeedbackPayload) {
  if (!payload.includeLogs) return undefined

  const logs = await readRecentLogs(FEEDBACK.DEFAULT_LOG_LINE_COUNT)
  if (!logs) return undefined

  return [
    '## Recent Logs',
    '',
    '<details><summary>Last 100 lines (redacted)</summary>',
    '',
    '```',
    logs,
    '```',
    '',
    '</details>',
  ].join('\n')
}

function appendMarkdownSection(sections: string[], section: string | undefined) {
  if (section) sections.push(section)
}

async function buildMarkdownBody(payload: FeedbackPayload) {
  const sections = [buildDescriptionSection(payload)]
  appendMarkdownSection(sections, buildSystemInfoSection(payload))
  appendMarkdownSection(sections, buildModelInfoSection(payload))
  appendMarkdownSection(sections, buildErrorContextSection(payload))
  appendMarkdownSection(sections, buildLastMessageSection(payload))
  appendMarkdownSection(sections, await buildLogsSection(payload))

  return sections.join('\n\n')
}

export function registerFeedbackHandlers(): void {
  typedHandle('feedback:check-gh', () =>
    Effect.gen(function* () {
      const ghAvailable = yield* Effect.tryPromise({
        try: () => execFilePromise('which', ['gh']).then(() => true),
        catch: () => false,
      })
      if (!ghAvailable) {
        return { available: false, authenticated: false }
      }

      const authenticated = yield* Effect.tryPromise({
        try: () =>
          execFilePromise('gh', ['auth', 'status'], { env: getGhCliEnv() }).then(() => true),
        catch: () => false,
      })
      return { available: true, authenticated }
    }),
  )

  typedHandle('feedback:collect-diagnostics', () => Effect.sync(() => collectDiagnostics()))

  typedHandle('feedback:get-recent-logs', (_event, lineCount) =>
    Effect.promise(() => readRecentLogs(lineCount)),
  )

  typedHandle('feedback:generate-markdown', (_event, payload) =>
    Effect.promise(() => buildMarkdownBody(payload)),
  )

  typedHandle('feedback:submit', (_event, payload) =>
    Effect.gen(function* () {
      const markdown = yield* Effect.promise(() => buildMarkdownBody(payload))
      const baseArgs = [
        'issue',
        'create',
        '--repo',
        FEEDBACK_REPO,
        '--title',
        payload.title,
        '--body',
        markdown,
      ]

      const env = getGhCliEnv()

      // Try with label first, fall back without if label doesn't exist in repo
      const stdoutResult = yield* Effect.tryPromise({
        try: async () => {
          try {
            const result = await execFilePromise('gh', [...baseArgs, '--label', payload.category], {
              env,
            })
            return result.stdout
          } catch {
            const result = await execFilePromise('gh', baseArgs, { env })
            return result.stdout
          }
        },
        catch: (error) => (error instanceof Error ? error.message : String(error)),
      })

      const urlMatch = stdoutResult.match(/https:\/\/github\.com\/\S+/)
      const issueUrl = urlMatch ? urlMatch[0].trim() : undefined

      logger.info('feedback issue created', { issueUrl })
      return {
        success: true,
        ...(issueUrl ? { issueUrl } : {}),
      } satisfies FeedbackSubmitResult
    }).pipe(
      Effect.catchAll((errorMessage) =>
        Effect.sync(() => {
          logger.error('failed to create feedback issue', { error: errorMessage })
          return { success: false, error: errorMessage } satisfies FeedbackSubmitResult
        }),
      ),
    ),
  )
}
