import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIncrementalMarkdown } from '@/features/chat/hooks/useIncrementalMarkdown';
import { SafeMarkdownLink } from '@/shared/lib/markdown-link-components';
import { safeMarkdownUrlTransform } from '@/shared/lib/markdown-safety';
import { isReactElementWithProps } from '@/shared/lib/react-element-guard';
import { CodeBlock } from './CodeBlock';
const REMARK_PLUGINS = [remarkGfm];
/**
 * Extract language from a <code className="language-xxx"> child inside a <pre>.
 */
function extractLanguage(children) {
    if (isReactElementWithProps(children)) {
        const className = children.props?.className;
        if (typeof className === 'string') {
            const match = /language-(\w+)/.exec(className);
            if (match)
                return match[1];
        }
    }
    return undefined;
}
/** Shared component overrides for both prefix and tail rendering. */
const markdownComponents = {
    a: SafeMarkdownLink,
    pre({ children }) {
        const language = extractLanguage(children);
        return _jsx(CodeBlock, { language: language, children: children });
    },
    code({ className, children, ...props }) {
        return (_jsx("code", { className: className, ...props, children: children }));
    },
};
function PrefixView({ prefixHast }) {
    return (_jsx(_Fragment, { children: toJsxRuntime(prefixHast, {
            Fragment,
            jsx,
            jsxs,
            components: markdownComponents,
        }) }));
}
export function IncrementalMarkdown({ text, isStreaming, highlighter, cache, rehypePlugins, tailRehypePlugins, }) {
    const { prefixHast, tail } = useIncrementalMarkdown(text, isStreaming, {
        highlighter,
        cache,
    });
    if (prefixHast !== null && isStreaming) {
        return (_jsxs(_Fragment, { children: [_jsx(PrefixView, { prefixHast: prefixHast }), _jsx(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS, rehypePlugins: tailRehypePlugins ?? rehypePlugins, urlTransform: safeMarkdownUrlTransform, components: markdownComponents, children: tail })] }));
    }
    return (_jsx(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS, rehypePlugins: rehypePlugins, urlTransform: safeMarkdownUrlTransform, components: markdownComponents, children: text }));
}
