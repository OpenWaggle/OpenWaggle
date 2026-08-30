import type { CliShimServiceInput } from './cli-shim-service'

export const MANAGED_CLI_SHIM_MARKER =
  '# Managed by OpenWaggle. Configure from Settings > Agent access.'

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function linuxManagedCliShimContent(command: string) {
  return `#!/bin/sh
${MANAGED_CLI_SHIM_MARKER}
openwaggle_pipe_dir=$(mktemp -d "\${TMPDIR:-/tmp}/openwaggle-cli.XXXXXX") || exit 1
openwaggle_stdout_pipe="$openwaggle_pipe_dir/stdout"
openwaggle_cleanup() {
  rm -f "$openwaggle_stdout_pipe"
  rmdir "$openwaggle_pipe_dir" 2>/dev/null || true
}
trap openwaggle_cleanup EXIT
openwaggle_command_pid=''
openwaggle_received_signal=''
openwaggle_forward_signal() {
  openwaggle_received_signal="$1"
  [ -n "$openwaggle_command_pid" ] || return
  case "$1" in
    HUP) kill -HUP "$openwaggle_command_pid" 2>/dev/null || true ;;
    INT) kill -INT "$openwaggle_command_pid" 2>/dev/null || true ;;
    TERM) kill -TERM "$openwaggle_command_pid" 2>/dev/null || true ;;
  esac
}
trap 'openwaggle_forward_signal HUP' HUP
trap 'openwaggle_forward_signal INT' INT
trap 'openwaggle_forward_signal TERM' TERM
mkfifo "$openwaggle_stdout_pipe" || exit 1
awk '
function is_empty_startup_line(line) {
  gsub(ansi_escape "\\\\[[0-9;]*m", "", line)
  return line ~ /^[[:space:]]*(\\[\\]|\\{\\})?[[:space:]]*$/
}
BEGIN { leading = 1; buffered = ""; ansi_escape = sprintf("%c", 27) }
leading && is_empty_startup_line($0) {
  buffered = buffered $0 ORS
  next
}
{
  leading = 0
  buffered = ""
  print
  fflush()
}
END {
  if (leading) printf "%s", buffered
}' < "$openwaggle_stdout_pipe" &
openwaggle_filter_pid=$!
${command} "$@" > "$openwaggle_stdout_pipe" &
openwaggle_command_pid=$!
if [ -n "$openwaggle_received_signal" ]; then
  openwaggle_forward_signal "$openwaggle_received_signal"
fi
while :; do
  wait "$openwaggle_command_pid"
  openwaggle_status=$?
  if [ -z "$openwaggle_received_signal" ] || ! kill -0 "$openwaggle_command_pid" 2>/dev/null; then
    break
  fi
done
trap '' HUP INT TERM
wait "$openwaggle_filter_pid"
openwaggle_filter_status=$?
if [ "$openwaggle_status" -ne 0 ]; then exit "$openwaggle_status"; fi
exit "$openwaggle_filter_status"
`
}

export function managedCliShimContent(input: CliShimServiceInput) {
  const arguments_ = input.appPath ? ` ${shellQuote(input.appPath)}` : ''
  const command = `${shellQuote(input.executablePath)}${arguments_}`
  return input.platform === 'linux'
    ? linuxManagedCliShimContent(command)
    : `#!/bin/sh\n${MANAGED_CLI_SHIM_MARKER}\nexec ${command} "$@"\n`
}
