/** Obvious automated clients, whose page views are dropped before they are counted. */
const BOT_USER_AGENT =
  /bot\b|crawl|spider|slurp|archiver|headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium|webdriver|curl\/|wget\/|python-|aiohttp|httpx|go-http-client|okhttp|java\/|libwww|axios\/|node-fetch|undici|postman|insomnia|scrapy|facebookexternalhit|embedly|whatsapp|skypeuripreview|uptime|pingdom|statuscake/iu

/** A browser User-Agent is far longer than this; shorter ones come from scripts. */
const MINIMUM_BROWSER_USER_AGENT_LENGTH = 20

export function isLikelyBot(userAgent: string) {
  if (userAgent.trim().length < MINIMUM_BROWSER_USER_AGENT_LENGTH) return true
  return BOT_USER_AGENT.test(userAgent)
}
