import { getCollection } from 'astro:content'
import { buildChangelogFeed } from '@/lib/changelog'
import { CHANGELOG_DESCRIPTION } from '@/lib/seo'

export async function GET() {
  const entries = await getCollection('changelog')
  const items = entries
    .toSorted((left, right) => left.data.order - right.data.order)
    .map(({ data, rendered }) => {
      if (rendered === undefined) {
        throw new Error(`Changelog entry ${data.version} was not rendered`)
      }
      return {
        version: data.version,
        html: rendered.html,
        ...(data.date === undefined ? {} : { date: data.date }),
      }
    })

  return new Response(buildChangelogFeed({ description: CHANGELOG_DESCRIPTION, items }), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
