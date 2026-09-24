import { describe, expect, it } from 'vitest'
import { enableEscapedExecCapture } from '../preparation-escaped-exec'

describe('escaped exec capture', () => {
  it('exposes unquoted exec to the capture alias without changing literals or heredocs', () => {
    const command = [
      "printf '%s' '\\exec' \"\\exec\"",
      '# \\exec in a comment',
      "cat <<'SCRIPT'",
      '\\exec in heredoc text',
      'SCRIPT',
      'export READY=yes; \\exec /usr/bin/true',
    ].join('\n')

    expect(enableEscapedExecCapture(command)).toBe(
      command.replace('export READY=yes; \\exec', 'export READY=yes; exec'),
    )
  })

  it('preserves escaped heredoc delimiters and multiple heredoc bodies', () => {
    const command = [
      'cat <<\\exec <<NEXT',
      '\\exec in the first body',
      'exec',
      '\\exec in the second body',
      'NEXT',
      '\\exec /usr/bin/true',
    ].join('\n')

    expect(enableEscapedExecCapture(command)).toBe(
      command.replace('\n\\exec /usr/bin/true', '\nexec /usr/bin/true'),
    )
  })

  it('does not mistake a here-string for a heredoc', () => {
    expect(enableEscapedExecCapture('cat <<< value\n\\exec /usr/bin/true')).toBe(
      'cat <<< value\nexec /usr/bin/true',
    )
  })

  it('exposes escaped command prefixes before exec without changing literals or heredocs', () => {
    const command = [
      "printf '%s' '\\command exec' \"\\builtin exec\"",
      '# \\command exec in a comment',
      "cat <<'SCRIPT'",
      '\\command exec in heredoc text',
      'SCRIPT',
      'export READY=yes; \\command exec /usr/bin/true',
      'export READY=yes; \\builtin exec /usr/bin/true',
    ].join('\n')

    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace('export READY=yes; \\command exec', 'export READY=yes; command exec')
        .replace('export READY=yes; \\builtin exec', 'export READY=yes; builtin exec'),
    )
  })

  it('rewrites a literal eval body at the exec site without changing printed literals', () => {
    const command = [
      String.raw`eval 'export READY=yes; \exec /usr/bin/true'`,
      String.raw`printf eval '\exec'`,
      String.raw`eval 'printf "%s" "\exec"; \exec /usr/bin/true'`,
    ].join('\n')

    expect(enableEscapedExecCapture(command)).toBe(
      [
        "eval 'export READY=yes; exec /usr/bin/true'",
        String.raw`printf eval '\exec'`,
        String.raw`eval 'printf "%s" "\exec"; exec /usr/bin/true'`,
      ].join('\n'),
    )
  })

  it('exposes escaped eval to the capture alias without changing quoted or heredoc text', () => {
    const command = [
      String.raw`printf '%s' '\eval' "\eval"`,
      String.raw`# \eval in a comment`,
      "cat <<'SCRIPT'",
      String.raw`\eval in heredoc text`,
      'SCRIPT',
      String.raw`code='export READY=yes; \exec /usr/bin/true'; \eval "$code"`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`; \eval "$code"`, '; __ow_eval "$code"'),
    )
  })
})
