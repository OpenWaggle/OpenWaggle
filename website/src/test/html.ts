/** Returns the opening tag of the element with this id, so assertions do not depend on attribute order. */
export function openingTag(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const tag = html.match(new RegExp(`<[a-z][^>]*\\sid="${escaped}"[^>]*>`, 'u'))?.[0];
  if (!tag) throw new Error(`No element with id "${id}"`);
  return tag;
}
