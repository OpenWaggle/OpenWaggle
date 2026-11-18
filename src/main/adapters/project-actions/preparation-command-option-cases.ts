/** Route supported command options to Setup capture wrappers without swallowing other commands. */
export function commandOptionCases(trapCommand: string) {
  const handled = (shift: string) => [
    `trap) ${shift}; ${trapCommand} "$@" ;;`,
    `exec) ${shift}; command exec "$@" ;;`,
    `eval|__ow_eval) ${shift}; __ow_eval "$@" ;;`,
    '*) command "$@" ;;',
  ]
  return [
    '-p) if [ "$2" = "--" ]; then',
    'case "$3" in',
    ...handled('shift 3'),
    'esac',
    'else',
    'case "$2" in',
    ...handled('shift 2'),
    'esac',
    'fi ;;',
    '--) case "$2" in',
    ...handled('shift 2'),
    'esac ;;',
  ]
}
