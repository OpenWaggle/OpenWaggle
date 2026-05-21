export function normalizeCommandQuery(query: string) {
  return query.toLowerCase().trim()
}

export function truncateCommandDescription(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}
