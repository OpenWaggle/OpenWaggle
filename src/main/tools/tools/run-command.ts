import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { z } from 'zod'
import { getSafeChildEnv } from '../../env'
import { createLogger } from '../../logger'
import type { NormalizedToolResult } from '../define-tool'
import { defineOpenWaggleTool } from '../define-tool'
import {
  type CommandPolicyRedirectDecision,
  evaluateCommandPolicy,
  formatCommandRedirectMessage,
} from './run-command-policy'

const logger = createLogger('tools:runCommand')
const MAX_LOG_PREVIEW_BYTES = 1024

export function isDangerousCommand(command: string): string | null {
  const decision = evaluateCommandPolicy(command)
  if (decision.action === 'redirect') {
    return formatCommandRedirectMessage(decision)
  }
  return null
}

export const runCommandTool = defineOpenWaggleTool({
  name: 'runCommand',
  description:
    'Run a shell command in the project directory. Use this for tasks like running tests, installing dependencies, git operations, grep, etc. The command runs in a shell.',
  needsApproval: true,
  inputSchema: z.object({
    command: z.string().describe('The shell command to run'),
    timeout: z
      .number()
      .optional()
      .describe('Timeout in milliseconds. Defaults to 30000 (30 seconds).'),
  }),
  async execute(args, context) {
    const decision = evaluateCommandPolicy(args.command)
    if (decision.action === 'redirect') {
      const guidance = buildGuidedPolicyResult(args.command, decision)
      logger.warn('command redirected by safety policy', {
        command: redactSensitiveText(args.command),
        ruleId: decision.ruleId,
        reason: decision.reason,
      })
      return guidance
    }

    const timeout = args.timeout ?? 30000
    const displayCommand =
      args.command.length > 200 ? `${args.command.slice(0, 200)}...` : args.command
    logger.info('executing command', {
      command: redactSensitiveText(args.command),
      cwd: context.projectPath,
      timeout,
    })
    const startTime = Date.now()
    const { shell, shellArgs } = resolveShellInvocation(args.command)

    return new Promise((resolve, reject) => {
      let aborted = false
      const proc = execFile(
        shell,
        shellArgs,
        {
          cwd: context.projectPath,
          timeout,
          maxBuffer: 1024 * 1024,
          env: getSafeChildEnv(),
        },
        (error, stdout, stderr) => {
          const durationMs = Date.now() - startTime
          if (error?.killed) {
            const killedOutcome = classifyKilledCommandOutcome({
              aborted,
              command: displayCommand,
              timeout,
            })
            logger.warn(killedOutcome.logMessage, {
              command: redactSensitiveText(args.command),
              durationMs,
              timeout,
            })
            reject(new Error(killedOutcome.userMessage))
            return
          }

          const output: string[] = []
          if (stdout.trim()) output.push(stdout.trim())
          if (stderr.trim()) output.push(`STDERR:\n${stderr.trim()}`)
          if (error) output.push(`Exit code: ${error.code}`)

          const stdoutPreview = toLogPreview(stdout)
          const stderrPreview = toLogPreview(stderr)
          logger.info('command completed', {
            command: redactSensitiveText(args.command),
            cwd: context.projectPath,
            shell,
            exitCode: error?.code ?? 0,
            durationMs,
            stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
            stderrBytes: Buffer.byteLength(stderr, 'utf8'),
            stdoutPreview: stdoutPreview.preview,
            stderrPreview: stderrPreview.preview,
            stdoutPreviewTruncated: stdoutPreview.truncated,
            stderrPreviewTruncated: stderrPreview.truncated,
          })

          resolve(output.join('\n\n') || '(no output)')
        },
      )

      if (context.signal) {
        if (context.signal.aborted) {
          aborted = true
          proc.kill()
          return
        }
        context.signal.addEventListener(
          'abort',
          () => {
            aborted = true
            proc.kill()
          },
          { once: true },
        )
      }
    })
  },
})

function resolveShellInvocation(command: string): { shell: string; shellArgs: string[] } {
  if (os.platform() === 'win32') {
    return {
      shell: 'cmd.exe',
      shellArgs: ['/d', '/s', '/c', command],
    }
  }

  if (fs.existsSync('/bin/bash')) {
    return {
      shell: '/bin/bash',
      shellArgs: ['-lc', command],
    }
  }

  return {
    shell: '/bin/sh',
    shellArgs: ['-c', command],
  }
}

interface KilledCommandOutcome {
  logMessage: 'command cancelled' | 'command timed out'
  userMessage: string
}

export function classifyKilledCommandOutcome(params: {
  aborted: boolean
  command: string
  timeout: number
}): KilledCommandOutcome {
  if (params.aborted) {
    return {
      logMessage: 'command cancelled',
      userMessage: `Command "${params.command}" was cancelled.`,
    }
  }

  return {
    logMessage: 'command timed out',
    userMessage: `Command "${params.command}" timed out after ${params.timeout}ms. Try a shorter command or increase the timeout.`,
  }
}

interface LogPreview {
  preview: string
  truncated: boolean
}

const SECRET_REDACTION_PATTERNS = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
] as const

export function redactSensitiveText(value: string): string {
  let redacted = value
  for (const matcher of SECRET_REDACTION_PATTERNS) {
    redacted = redacted.replace(matcher.pattern, matcher.replacement)
  }
  return redacted
}

export function toLogPreview(value: string): LogPreview {
  const redacted = redactSensitiveText(value)
  const bytes = Buffer.from(redacted, 'utf8')
  if (bytes.length <= MAX_LOG_PREVIEW_BYTES) {
    return {
      preview: redacted,
      truncated: false,
    }
  }

  const preview = bytes.subarray(0, MAX_LOG_PREVIEW_BYTES).toString('utf8')
  return {
    preview: `${preview}... [truncated in log]`,
    truncated: true,
  }
}

function buildGuidedPolicyResult(
  command: string,
  decision: CommandPolicyRedirectDecision,
): NormalizedToolResult {
  return {
    kind: 'json',
    data: {
      ok: false,
      status: 'blocked_with_guidance',
      policy: 'command-safety',
      attemptedCommand: redactSensitiveText(command),
      ruleId: decision.ruleId,
      reason: decision.reason,
      instruction: decision.instruction,
      nextSteps: [...decision.nextSteps],
      safeCommandExamples: [...decision.safeCommandExamples],
      message: formatCommandRedirectMessage(decision),
    },
  }
}
