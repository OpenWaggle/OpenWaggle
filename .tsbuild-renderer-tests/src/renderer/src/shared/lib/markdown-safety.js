import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
/** Shiki uses language-* classes on code elements and line/shiki classes on spans/pre. */
const shikiClassDefinition = [
    'className',
    /^language-[\w-]+$/,
    'line',
    /^shiki(?:-[\w-]+)?$/,
];
const anchorTargetDefinition = ['target', '_blank'];
const anchorRelDefinition = ['rel', 'noopener', 'noreferrer', 'nofollow'];
const ALLOWED_HREF_PROTOCOLS = ['http', 'https', 'mailto', 'tel'];
/** Shiki uses inline `style` attributes for syntax token colors. */
const styleAttributeDefinition = 'style';
function schemaAttributesForTag(tagName) {
    const tagAttributes = defaultSchema.attributes?.[tagName];
    return tagAttributes ? [...tagAttributes] : [];
}
function extractProtocol(rawUrl) {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl)
        return null;
    const match = PROTOCOL_PATTERN.exec(trimmedUrl);
    if (!match)
        return null;
    return match[0].toLowerCase();
}
export function isAllowedMarkdownUrl(rawUrl) {
    const protocol = extractProtocol(rawUrl);
    if (!protocol)
        return false;
    return ALLOWED_LINK_PROTOCOLS.has(protocol);
}
export const safeMarkdownUrlTransform = (url) => {
    const trimmedUrl = url.trim();
    if (!isAllowedMarkdownUrl(trimmedUrl))
        return undefined;
    return trimmedUrl;
};
export const safeMarkdownSanitizeSchema = {
    ...defaultSchema,
    protocols: {
        ...(defaultSchema.protocols ?? {}),
        href: ALLOWED_HREF_PROTOCOLS,
    },
    attributes: {
        ...(defaultSchema.attributes ?? {}),
        a: [...schemaAttributesForTag('a'), anchorTargetDefinition, anchorRelDefinition],
        code: [...schemaAttributesForTag('code'), shikiClassDefinition, styleAttributeDefinition],
        pre: [...schemaAttributesForTag('pre'), shikiClassDefinition, styleAttributeDefinition],
        span: [...schemaAttributesForTag('span'), shikiClassDefinition, styleAttributeDefinition],
    },
};
/**
 * Default rehype plugins for non-streaming markdown (e.g. SkillsPanel).
 * Sanitize-only — Shiki highlighting is wired separately in StreamingText.
 */
export const safeMarkdownRehypePlugins = [
    [rehypeSanitize, safeMarkdownSanitizeSchema],
];
