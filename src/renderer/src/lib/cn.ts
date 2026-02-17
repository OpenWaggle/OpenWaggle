/**
 * Minimal class name utility — no dependencies.
 * Usage: cn('base', condition && 'conditional', 'always')
 */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(' ')
}
