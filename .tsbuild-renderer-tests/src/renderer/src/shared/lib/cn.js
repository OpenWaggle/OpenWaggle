/**
 * Minimal class name utility — no dependencies.
 * Usage: cn('base', condition && 'conditional', 'always')
 */
export function cn(...inputs) {
    return inputs.filter(Boolean).join(' ');
}
