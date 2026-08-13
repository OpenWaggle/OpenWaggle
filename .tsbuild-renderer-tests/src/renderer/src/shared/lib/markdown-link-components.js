import { jsx as _jsx } from "react/jsx-runtime";
import { isAllowedMarkdownUrl } from './markdown-safety';
export function SafeMarkdownLink({ href, children }) {
    if (!href || !isAllowedMarkdownUrl(href)) {
        return _jsx("span", { children: children });
    }
    return (_jsx("a", { href: href, target: "_blank", rel: "noopener noreferrer nofollow", children: children }));
}
export const safeMarkdownComponents = {
    a: SafeMarkdownLink,
};
