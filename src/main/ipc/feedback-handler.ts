import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { BASE_TEN, BYTES_PER_KIBIBYTE } from '@shared/constants/constants'
import type { DiagnosticsInfo, FeedbackPayload } from '@shared/types/feedback'
import { app } from 'electron'
import { getGhCliEnv } from '../env'
import { createLogger, getLogFilePath } from '../logger'
import { redactSensitiveText } from '../utils/redact'
import { safeHandle } from './typed-ipc'

const logger = createLogger('ipc:feedback')

const FEEDBACK_REPO = 'OpenWaggle/OpenWaggle'
const DEFAULT_LOG_LINE_COUNT = 100

function execFilePromise(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
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

function humanOsName(): string {
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

async function readRecentLogs(lineCount: number): Promise<string> {
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

async function buildMarkdownBody(payload: FeedbackPayload): Promise<string> {
  const sections: string[] = []

  sections.push(`## Description\n\n${payload.description || '_No description provided._'}`)

  if (payload.includeSystemInfo) {
    const info = collectDiagnostics()
    sections.push(
      [
        '## System Info',
        '',
        `| Field | Value |`,
        `|-------|-------|`,
        `| OS | ${info.os} |`,
        `| App Version | ${info.appVersion} |`,
        `| Electron | ${info.electronVersion} |`,
        `| Node.js | ${info.nodeVersion} |`,
        `| Arch | ${info.arch} |`,
      ].join('\n'),
    )
  }

  if (payload.includeModelInfo && (payload.activeModel ?? payload.activeProvider)) {
    const modelLines = ['## Model Info', '']
    if (payload.activeProvider) modelLines.push(`- **Provider:** ${payload.activeProvider}`)
    if (payload.activeModel) modelLines.push(`- **Model:** ${payload.activeModel}`)
    sections.push(modelLines.join('\n'))
  }

  if (payload.includeErrorContext && payload.lastErrorContext) {
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
    sections.push(errorLines.join('\n'))
  }

  if (payload.includeLastMessage && payload.lastUserMessage) {
    sections.push(
      [
        '## Last User Message',
        '',
        '<details><summary>Message content</summary>',
        '',
        '```',
        payload.lastUserMessage,
        '```',
        '',
        '</details>',
      ].join('\n'),
    )
  }

  if (payload.includeLogs) {
    const logs = await readRecentLogs(DEFAULT_LOG_LINE_COUNT)
    if (logs) {
      sections.push(
        [
          '## Recent Logs',
          '',
          '<details><summary>Last 100 lines (redacted)</summary>',
          '',
          '```',
          logs,
          '```',
          '',
          '</details>',
        ].join('\n'),
      )
    }
  }

  return sections.join('\n\n')
}

export function registerFeedbackHandlers(): void {
  safeHandle('feedback:check-gh', async () => {
    try {
      await execFilePromise('which', ['gh'])
    } catch {
      return { available: false, authenticated: false }
    }

    try {
      await execFilePromise('gh', ['auth', 'status'], { env: getGhCliEnv() })
      return { available: true, authenticated: true }
    } catch {
      return { available: true, authenticated: false }
    }
  })

  safeHandle('feedback:collect-diagnostics', () => {
    return collectDiagnostics()
  })

  safeHandle('feedback:get-recent-logs', async (_event, lineCount) => {
    return readRecentLogs(lineCount)
  })

  safeHandle('feedback:generate-markdown', async (_event, payload) => {
    return buildMarkdownBody(payload)
  })

  safeHandle('feedback:submit', async (_event, payload) => {
    const markdown = await buildMarkdownBody(payload)
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

    try {
      // Try with label first, fall back without if label doesn't exist in repo
      const env = getGhCliEnv()
      let stdout: string
      try {
        const result = await execFilePromise('gh', [...baseArgs, '--label', payload.category], {
          env,
        })
        stdout = result.stdout
      } catch {
        const result = await execFilePromise('gh', baseArgs, { env })
        stdout = result.stdout
      }

      const urlMatch = stdout.match(/https:\/\/github\.com\/\S+/)
      const issueUrl = urlMatch ? urlMatch[0].trim() : undefined

      logger.info('feedback issue created', { issueUrl })
      return { success: true, issueUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('failed to create feedback issue', { error: message })
      return { success: false, error: message }
    }
  })
}
