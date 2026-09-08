import { join } from 'node:path'

export function buildZshStartupScripts(options: {
  readonly directory: string
  readonly originalZdotdir: string | undefined
  readonly readinessNonce: string
}) {
  const identifier = shellIdentifier(options.readinessNonce)
  const userDirectoryVariable = `__openwaggle_user_zdotdir_${identifier}`
  const userDirectorySetVariable = `${userDirectoryVariable}_is_set`
  const markerVariable = `__openwaggle_readiness_marker_${identifier}`
  const hookFunction = `__openwaggle_prompt_readiness_${identifier}`
  const integration = zshPromptIntegration(options.readinessNonce, markerVariable, hookFunction)
  const shared = {
    directory: options.directory,
    userDirectoryVariable,
    userDirectorySetVariable,
  }

  return {
    '.zshenv': zshStartupWrapper({
      ...shared,
      startupFile: '.zshenv',
      captureInitialState: true,
      initialUserDirectory: options.originalZdotdir,
      integration,
    }),
    '.zprofile': zshStartupWrapper({ ...shared, startupFile: '.zprofile', integration }),
    '.zshrc': zshStartupWrapper({ ...shared, startupFile: '.zshrc', integration }),
    '.zlogin': zshStartupWrapper({
      ...shared,
      startupFile: '.zlogin',
      integration,
      finalStartupFile: true,
    }),
  } as const
}

export function buildBashProfileWrapper(options: {
  readonly integrationHome: string
  readonly originalHome: string
  readonly readinessNonce: string
}) {
  const identifier = shellIdentifier(options.readinessNonce)
  const markerVariable = `__openwaggle_readiness_marker_${identifier}`
  const hookFunction = `__openwaggle_prompt_readiness_${identifier}`
  const originalHome = posixShellQuote(options.originalHome)
  const integrationHistory = posixShellQuote(join(options.integrationHome, '.bash_history'))
  return `export HOME=${originalHome}
if [[ "\${HISTFILE-}" == ${integrationHistory} ]]; then
  HISTFILE="$HOME/.bash_history"
fi
if [[ -r "$HOME/.bash_profile" ]]; then
  builtin source "$HOME/.bash_profile"
elif [[ -r "$HOME/.bash_login" ]]; then
  builtin source "$HOME/.bash_login"
elif [[ -r "$HOME/.profile" ]]; then
  builtin source "$HOME/.profile"
fi
${markerVariable}=$'\\[\\e]633;B;${options.readinessNonce}\\a\\]'
function ${hookFunction} {
  if [[ "\${PS1-}" != *"$${markerVariable}"* ]]; then
    PS1="\${PS1-}$${markerVariable}"
  fi
}
if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
  case "$(builtin declare -p PROMPT_COMMAND 2>/dev/null)" in
    'declare -a '*) PROMPT_COMMAND+=("${hookFunction}") ;;
    *) PROMPT_COMMAND="\${PROMPT_COMMAND:+\${PROMPT_COMMAND}
}${hookFunction}" ;;
  esac
else
  PROMPT_COMMAND="\${PROMPT_COMMAND:+\${PROMPT_COMMAND}
}${hookFunction}"
fi
`
}

export function buildFishPromptIntegration(readinessNonce: string) {
  const identifier = shellIdentifier(readinessNonce)
  const installer = `__openwaggle_install_prompt_readiness_${identifier}`
  const originalPrompt = `__openwaggle_original_fish_prompt_${identifier}`
  return `function ${installer} --on-event fish_prompt
  if functions --query fish_prompt
    functions --copy fish_prompt ${originalPrompt}
    functions --erase ${installer}
    function fish_prompt
      ${originalPrompt} $argv
      builtin printf '\\e]633;B;${readinessNonce}\\a'
    end
  end
end
${installer}`
}

export function buildPowerShellPromptIntegration(readinessNonce: string) {
  const stateVariable = `__OpenWagglePromptReadiness_${shellIdentifier(readinessNonce)}`
  return `$Global:${stateVariable} = @{
  OriginalPrompt = $function:Prompt
  Marker = "$([char]0x1b)]633;B;${readinessNonce}\`a"
}
function Global:Prompt {
  $OpenWaggleFailed = [int]!$Global:?
  $OpenWaggleResult = ""
  if ($OpenWaggleFailed -ne 0) { Write-Error "failure" -ErrorAction Ignore }
  $OpenWaggleResult += $Global:${stateVariable}.OriginalPrompt.Invoke()
  $OpenWaggleResult += $Global:${stateVariable}.Marker
  return $OpenWaggleResult
}`
}

export function buildCmdPromptIntegration(readinessNonce: string) {
  return `@setlocal EnableDelayedExpansion\r
@echo off\r
if not defined PROMPT set "PROMPT=$P$G"\r
set "OPENWAGGLE_PROMPT=!PROMPT!$E]633;B;${readinessNonce}\u0007"\r
for /F "delims=" %%A in ("!OPENWAGGLE_PROMPT!") do endlocal ^& set "PROMPT=%%A"\r
`
}

interface ZshStartupWrapperOptions {
  readonly startupFile: '.zshenv' | '.zprofile' | '.zshrc' | '.zlogin'
  readonly directory: string
  readonly userDirectoryVariable: string
  readonly userDirectorySetVariable: string
  readonly captureInitialState?: boolean
  readonly initialUserDirectory?: string
  readonly integration?: string
  readonly finalStartupFile?: boolean
}

function zshStartupWrapper(options: ZshStartupWrapperOptions) {
  const integrationDirectory = posixShellQuote(options.directory)
  const captureState = options.captureInitialState
    ? options.initialUserDirectory === undefined
      ? `typeset -g ${options.userDirectoryVariable}="$HOME"\ntypeset -gi ${options.userDirectorySetVariable}=0`
      : `typeset -g ${options.userDirectoryVariable}=${posixShellQuote(options.initialUserDirectory)}\ntypeset -gi ${options.userDirectorySetVariable}=1`
    : `if (( ! \${+ZDOTDIR} )); then\n  typeset -g ${options.userDirectoryVariable}="$HOME"\n  typeset -gi ${options.userDirectorySetVariable}=0\nelif [[ "$ZDOTDIR" != ${integrationDirectory} ]]; then\n  typeset -g ${options.userDirectoryVariable}="$ZDOTDIR"\n  typeset -gi ${options.userDirectorySetVariable}=1\nfi`
  const restoreUserDirectory = `if (( ${options.userDirectorySetVariable} )); then\n  export ZDOTDIR="$${options.userDirectoryVariable}"\nelse\n  unset ZDOTDIR\nfi`
  const captureAfterSource = `if (( \${+ZDOTDIR} )); then\n  typeset -g ${options.userDirectoryVariable}="$ZDOTDIR"\n  typeset -gi ${options.userDirectorySetVariable}=1\nelse\n  typeset -g ${options.userDirectoryVariable}="$HOME"\n  typeset -gi ${options.userDirectorySetVariable}=0\nfi`
  const finish = options.finalStartupFile
    ? `${restoreUserDirectory}\nunset ${options.userDirectoryVariable} ${options.userDirectorySetVariable}`
    : `if [[ $options[rcs] = off ]]; then\n  ${restoreUserDirectory.replaceAll('\n', '\n  ')}\n  unset ${options.userDirectoryVariable} ${options.userDirectorySetVariable}\nelse\n  export ZDOTDIR=${integrationDirectory}\nfi`

  return `${captureState}
${restoreUserDirectory}
if [[ -r "$${options.userDirectoryVariable}/${options.startupFile}" ]]; then
  builtin source "$${options.userDirectoryVariable}/${options.startupFile}"
fi
${captureAfterSource}
${options.integration ?? ''}
${finish}
`
}

function zshPromptIntegration(
  readinessNonce: string,
  markerVariable: string,
  hookFunction: string,
) {
  return `typeset -g ${markerVariable}=$'\\e]633;B;${readinessNonce}\\a'
function ${hookFunction} {
  if [[ "$PROMPT" != *"$${markerVariable}"* ]]; then
    PROMPT="${'$'}{PROMPT}%{${'$'}{${markerVariable}}%}"
  fi
}
builtin autoload -Uz add-zsh-hook
add-zsh-hook -d precmd ${hookFunction} 2>/dev/null || builtin true
add-zsh-hook precmd ${hookFunction}
`
}

function shellIdentifier(readinessNonce: string) {
  return readinessNonce.replaceAll('-', '_')
}

function posixShellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
