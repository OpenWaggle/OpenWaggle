/** "it" or "them", "was" or "were", and so on, for a sentence about `count` secrets or arguments. */
export function mcpCountWords(count: number) {
  return count === 1
    ? {
        plural: '',
        object: 'it',
        exists: 'exists',
        holds: 'it holds',
        was: 'was',
        needs: 'it needs',
      }
    : {
        plural: 's',
        object: 'them',
        exists: 'exist',
        holds: 'they hold',
        was: 'were',
        needs: 'they need',
      }
}
