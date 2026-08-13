export function normalizeCommandQuery(query) {
    return query.toLowerCase().trim();
}
export function truncateCommandDescription(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
