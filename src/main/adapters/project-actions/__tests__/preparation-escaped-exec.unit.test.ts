import { describe, expect, it } from 'vitest'
import { enableEscapedExecCapture } from '../preparation-escaped-exec'

describe('escaped exec capture', () => {
  it('captures quote-suppressed eval only at command position', () => {
    const command = [
      String.raw`code='export READY=yes; \exec /usr/bin/true'; e"va"l "$code"`,
      String.raw`code='export READY=yes; \exec /usr/bin/true'; ev\al "$code"`,
      `printf '%s' e"va"l`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace('e"va"l "$code"', '__ow_eval "$code"')
        .replace(String.raw`ev\al "$code"`, '__ow_eval "$code"'),
    )
  })
  it('captures ANSI-C-quoted builtins only at command position', () => {
    const command = [
      `e$'va'l "$code"`,
      `$'eval' "$code"`,
      `ex$'e'c /usr/bin/true`,
      String.raw`$'\x65\u0076\141\U0000006c' "$code"`,
      String.raw`e$'\u76'al "$code"`,
      `printf '%s' e$'va'l ex$'e'c`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace(`e$'va'l "$code"`, '__ow_eval "$code"')
        .replace(`$'eval' "$code"`, '__ow_eval "$code"')
        .replace(`ex$'e'c /usr/bin/true`, 'exec /usr/bin/true')
        .replace(String.raw`$'\x65\u0076\141\U0000006c' "$code"`, '__ow_eval "$code"')
        .replace(String.raw`e$'\u76'al "$code"`, '__ow_eval "$code"'),
    )
  })
  it('captures locale-quoted builtins only at command position', () => {
    const command = [
      `$"eval" "$code"`,
      `e$"va"l "$code"`,
      `ex$"e"c /usr/bin/true`,
      `printf '%s' e$"va"l ex$"e"c`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace(`$"eval" "$code"`, '__ow_eval "$code"')
        .replace(`e$"va"l "$code"`, '__ow_eval "$code"')
        .replace(`ex$"e"c /usr/bin/true`, 'exec /usr/bin/true'),
    )
  })
  it('keeps dollar-quoted commands literal when a shell does not support the form', () => {
    const ansi = `e$'va'l "$code"`
    const locale = `$"eval" "$code"`
    expect(enableEscapedExecCapture(ansi, { ansi: false, locale: false })).toBe(ansi)
    expect(enableEscapedExecCapture(locale, { ansi: true, locale: false })).toBe(locale)
  })
  it('exposes partially escaped exec only in command position', () => {
    const command = [
      String.raw`export READY=yes; ex\ec /usr/bin/true`,
      String.raw`command e\xec /usr/bin/true`,
      'ex"e"c /usr/bin/true',
      String.raw`printf '%s' ex\ec`,
      String.raw`# ex\ec in a comment`,
      String.raw`printf '%s' 'ex\ec'`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace(String.raw`ex\ec /usr/bin/true`, 'exec /usr/bin/true')
        .replace(String.raw`e\xec /usr/bin/true`, 'exec /usr/bin/true')
        .replace('ex"e"c /usr/bin/true', 'exec /usr/bin/true'),
    )
  })
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

  it('preserves command-looking text under punctuated quoted heredoc delimiters', () => {
    const command = [
      "cat <<'END.JSON'",
      String.raw`ex\ec literal`,
      'END.JSON',
      String.raw`export READY=yes; ex\ec /usr/bin/true`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`ex\ec /usr/bin/true`, 'exec /usr/bin/true'),
    )
  })

  it('does not mistake an arithmetic left shift for a heredoc', () => {
    const command = String.raw`export READY=yes; : $((1 << 2))
ex\ec /usr/bin/true`
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`ex\ec /usr/bin/true`, 'exec /usr/bin/true'),
    )
  })

  it('does not mistake an arithmetic command left shift for a heredoc', () => {
    const command = String.raw`export READY=yes; ((1 << 2))
ex\ec /usr/bin/true`
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`ex\ec /usr/bin/true`, 'exec /usr/bin/true'),
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

  it('leaves escaped eval arguments alone while rewriting command-position invocations', () => {
    const command = [
      String.raw`export LABEL=$(printf '%s' \eval)`,
      String.raw`printf '%s' \eval > literal.txt`,
      String.raw`command \eval 'export READY=yes'`,
      String.raw`if true; then \eval 'export CONDITIONAL=yes'; fi`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replace(String.raw`command \eval`, 'command __ow_eval')
        .replace(String.raw`then \eval`, 'then __ow_eval'),
    )
  })

  it('recognizes quoted and escaped assignment words before an escaped eval command', () => {
    const command = [
      String.raw`LABEL='hello world' \eval 'export READY=yes'`,
      String.raw`LABEL='hello; world' \eval 'export READY=yes'`,
      String.raw`LABEL=hello\ world \eval 'export READY=yes'`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replaceAll(String.raw`\eval`, '__ow_eval'),
    )
  })

  it('treats a case-arm pattern closer as an escaped eval command boundary', () => {
    const command = [
      String.raw`case x in x) \eval "$code";; esac`,
      String.raw`case x in (x) \eval "$code";; esac`,
      String.raw`case x in
  (x) \eval "$code";;
esac`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replaceAll(String.raw`\eval`, '__ow_eval'),
    )
  })

  it('captures escaped eval at the start of inline function bodies', () => {
    const command = [
      String.raw`f() { \eval "$code"; }; f`,
      String.raw`function g { \eval "$code"; }; g`,
      String.raw`printf '%s' \eval`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replaceAll(String.raw`{ \eval "$code"`, '{ __ow_eval "$code"'),
    )
  })

  it('keeps command position across leading redirections and their targets', () => {
    const command = [
      String.raw`>/dev/null \eval "$code"`,
      String.raw`> /dev/null \eval "$code"`,
      String.raw`2>&1 \eval "$code"`,
      String.raw`> 'output with space' \eval "$code"`,
      String.raw`command>/dev/null \eval "$code"`,
      String.raw`printf >/dev/null \eval`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replaceAll(String.raw`\eval "$code"`, '__ow_eval "$code"'),
    )
    expect(enableEscapedExecCapture(String.raw`> \eval`)).toBe(String.raw`> \eval`)
    expect(enableEscapedExecCapture(String.raw`printf > /dev/null \eval "$code"`)).toBe(
      String.raw`printf > /dev/null \eval "$code"`,
    )
  })

  it('keeps command position across supported prefix options only', () => {
    const command = [
      String.raw`command -- \eval "$code"`,
      String.raw`command -p \eval "$code"`,
      String.raw`command -p -- \eval "$code"`,
      String.raw`time -p \eval "$code"`,
      String.raw`printf -- \eval "$code"`,
      String.raw`command -v \eval "$code"`,
      String.raw`command -- -p \eval "$code"`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command
        .replaceAll(String.raw`command -- \eval`, 'command -- __ow_eval')
        .replaceAll(String.raw`command -p \eval`, 'command -p __ow_eval')
        .replaceAll(String.raw`command -p -- \eval`, 'command -p -- __ow_eval')
        .replaceAll(String.raw`time -p \eval`, 'time -p __ow_eval'),
    )
  })

  it('keeps escaped eval arguments after parameter and brace expansions', () => {
    const command = [
      `printf '%s %s' \${VALUE} \\eval`,
      String.raw`printf '%s %s' {left,right} \eval`,
      String.raw`{ \eval "$code"; }`,
    ].join('\n')
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`{ \eval "$code"; }`, '{ __ow_eval "$code"; }'),
    )
  })

  it('recognizes escaped eval after a continued newline', () => {
    const command = `code='export READY=yes; \\exec /usr/bin/true'; \\
  \\eval "$code"`
    expect(enableEscapedExecCapture(command)).toBe(command.replace(String.raw`\eval`, '__ow_eval'))
    const argument = `printf '%s' \\
  \\eval`
    expect(enableEscapedExecCapture(argument)).toBe(argument)
  })

  it('keeps an escaped eval argument after a multiline command substitution', () => {
    const command = String.raw`printf '%s %s' $(printf x
) \eval
code='export READY=yes; \exec /usr/bin/true'; \eval "$code"`
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`; \eval "$code"`, '; __ow_eval "$code"'),
    )
  })

  it('keeps quoted newlines inside a word before a later escaped exec', () => {
    const command = `printf '%s' "foo\nbar"; export READY=yes; ex\\ec /usr/bin/true`
    expect(enableEscapedExecCapture(command)).toBe(
      command.replace(String.raw`ex\ec /usr/bin/true`, 'exec /usr/bin/true'),
    )
  })
})
