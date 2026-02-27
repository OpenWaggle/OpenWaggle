export interface CommandPolicyAllowDecision {
  action: 'allow'
}

export interface CommandPolicyRedirectDecision {
  action: 'redirect'
  ruleId: string
  reason: string
  instruction: string
  nextSteps: readonly string[]
  safeCommandExamples: readonly string[]
}

export type CommandPolicyDecision = CommandPolicyAllowDecision | CommandPolicyRedirectDecision

interface CommandPolicyRule {
  id: string
  pattern: RegExp
  reason: string
  instruction: string
  nextSteps: readonly string[]
  safeCommandExamples: readonly string[]
}

const POLICY_RULES = [
  {
    id: 'destructive-delete-root',
    pattern:
      /(^|[^A-Za-z0-9_])rm\s+-rf\s+(\/($|[^A-Za-z0-9_])|~($|[^A-Za-z0-9_])|\$HOME($|[^A-Za-z0-9_]))/i,
    reason: 'destructive recursive delete against root/home paths',
    instruction:
      'Switch to a scoped cleanup workflow: inspect target paths first, then delete only explicit project-local directories.',
    nextSteps: [
      'Inspect the current location and target directory size before deleting anything.',
      'List candidate directories/files explicitly and confirm scope.',
      'Use interactive or path-scoped delete commands (never root/home-wide deletes).',
    ],
    safeCommandExamples: ['pwd', 'ls -la', 'du -sh ./dist', 'rm -ri ./dist'],
  },
  {
    id: 'remote-script-pipe',
    pattern: /\b(curl|wget)\b[^|]*\|\s*(bash|sh)\b/i,
    reason: 'remote script piping directly into a shell',
    instruction:
      'Download first, inspect the script, verify checksum/signature, then run locally with explicit arguments.',
    nextSteps: [
      'Download the script to a local file instead of piping to a shell.',
      'Inspect script contents and verify provenance/checksum.',
      'Execute the saved script explicitly only after validation.',
    ],
    safeCommandExamples: [
      'curl -fsSL <url> -o script.sh',
      'sed -n "1,160p" script.sh',
      'shasum -a 256 script.sh',
      'bash script.sh --help',
    ],
  },
  {
    id: 'world-writable-permissions',
    pattern: /\bchmod\s+777\b/i,
    reason: 'overly broad world-writable file permissions',
    instruction:
      'Use least-privilege permissions and set ownership explicitly instead of chmod 777.',
    nextSteps: [
      'Check current ownership and permissions before changing modes.',
      'Prefer targeted permissions (for example 755 for dirs, 644 for files).',
      'Update owner/group when permission problems are ownership-related.',
    ],
    safeCommandExamples: [
      'ls -l <path>',
      'chmod 755 <directory>',
      'chmod 644 <file>',
      'chown <user>:<group> <path>',
    ],
  },
  {
    id: 'raw-disk-write',
    pattern: /(\bdd\s+if=)|(>\s*\/dev\/sda\b)/i,
    reason: 'raw disk write/copy operation',
    instruction:
      'Use non-destructive diagnostics first and require an explicitly scoped target/device review before any low-level disk operation.',
    nextSteps: [
      'Inspect mounted devices and partitions first.',
      'Confirm the exact target device path and expected size.',
      'Use read-only diagnostics before any write operation.',
    ],
    safeCommandExamples: ['lsblk', 'diskutil list', 'df -h'],
  },
  {
    id: 'fork-bomb',
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/i,
    reason: 'fork bomb process-exhaustion pattern',
    instruction:
      'Do not run process-exhaustion constructs. Use bounded process diagnostics and targeted process control commands.',
    nextSteps: [
      'Inspect current process load with a read-only command.',
      'If debugging runaway processes, identify exact PIDs before acting.',
      'Use targeted kill commands only against confirmed process IDs.',
    ],
    safeCommandExamples: ['ps aux | head -n 20', 'top -l 1', 'kill -TERM <pid>'],
  },
  {
    id: 'eval-exec-source-untrusted',
    pattern: /\b(eval|exec)\s+\$\(|\bsource\s+<\(|\bsource\s+\$\(/i,
    reason: 'eval/exec/source from dynamically generated or remote input',
    instruction:
      'Avoid eval/exec/source with dynamic or remote input. Write the generated content to a file, inspect it, then execute explicitly.',
    nextSteps: [
      'Redirect the dynamic output to a local file instead of eval/exec.',
      'Inspect the generated content before running it.',
      'Execute the file explicitly after validation.',
    ],
    safeCommandExamples: [
      'command_output=$(some-tool); echo "$command_output" > generated.sh',
      'cat generated.sh',
      'bash generated.sh',
    ],
  },
  {
    id: 'recursive-permission-change-root',
    pattern:
      /\b(chmod|chown)\s+-R\s+\S+\s+(\/($|[^A-Za-z0-9_])|~($|[^A-Za-z0-9_])|\$HOME($|[^A-Za-z0-9_]))/i,
    reason: 'recursive permission/ownership change on root or home paths',
    instruction:
      'Never recursively change permissions on root or home directories. Scope changes to specific project directories.',
    nextSteps: [
      'Identify the specific directory that needs permission changes.',
      'Use a scoped, non-recursive command for targeted files.',
      'Verify current permissions before making changes.',
    ],
    safeCommandExamples: [
      'ls -la <directory>',
      'chmod 755 ./specific-dir',
      'chown user:group ./specific-file',
    ],
  },
  {
    id: 'env-secret-exfiltration',
    pattern: /\b(env|printenv|set)\b[^|]*\|\s*(curl|wget|nc|ncat|netcat)\b/i,
    reason: 'environment variable exfiltration via network tools',
    instruction:
      'Never pipe environment variables to network tools. Access specific environment variables individually when needed.',
    nextSteps: [
      'Identify the specific variable you need.',
      'Use echo $VARIABLE_NAME to inspect individual values.',
      'Never send environment contents over the network.',
    ],
    safeCommandExamples: ['echo $PATH', 'echo $HOME', 'printenv SPECIFIC_VAR'],
  },
] as const satisfies readonly CommandPolicyRule[]

export function evaluateCommandPolicy(command: string): CommandPolicyDecision {
  const normalized = normalizeCommand(command)

  for (const rule of POLICY_RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        action: 'redirect',
        ruleId: rule.id,
        reason: rule.reason,
        instruction: rule.instruction,
        nextSteps: rule.nextSteps,
        safeCommandExamples: rule.safeCommandExamples,
      }
    }
  }

  return { action: 'allow' }
}

export function formatCommandRedirectMessage(decision: CommandPolicyRedirectDecision): string {
  const steps = decision.nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')
  const examples = decision.safeCommandExamples.map((example) => `- ${example}`).join('\n')

  return [
    `Command not executed by command-safety policy (${decision.ruleId}).`,
    `Reason: ${decision.reason}.`,
    `Instruction: ${decision.instruction}`,
    '',
    'Next steps:',
    steps,
    '',
    'Safe command examples:',
    examples,
  ].join('\n')
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}
