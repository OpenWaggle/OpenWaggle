import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { createRendererLogger } from '@/shared/lib/logger';
import { DEFAULT_THEME, getHighlighter, resolveLanguage } from '@/shared/lib/shiki/highlighter';
const TEXTAREA_BASE_CLASS = 'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 text-text-secondary outline-none transition-colors placeholder:text-text-muted focus:border-border-light';
const TEXTAREA_VARIANT_CLASS = {
    default: 'text-[13px]',
    mono: 'font-mono text-[12px] leading-5',
};
const TEXTAREA_LINE_CLASS = {
    default: 'min-h-[1.45em]',
    mono: 'min-h-5',
};
const TEXTAREA_RESIZE_CLASS = {
    none: 'resize-none',
    vertical: 'resize-y',
    both: 'resize',
};
const logger = createRendererLogger('textarea');
function assignRef(ref, value) {
    if (!ref)
        return;
    if (typeof ref === 'function') {
        ref(value);
        return;
    }
    ref.current = value;
}
function getTextareaValue(value) {
    if (Array.isArray(value)) {
        return value.join('\n');
    }
    if (value === undefined || value === null) {
        return '';
    }
    return String(value);
}
function getTokenStyle(token) {
    if (!token.color && !token.bgColor) {
        return undefined;
    }
    return {
        ...(token.color ? { color: token.color } : {}),
        ...(token.bgColor ? { backgroundColor: token.bgColor } : {}),
    };
}
function syncOverlayScroll(textarea, overlay) {
    if (!textarea || !overlay)
        return;
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
}
function getHighlightedLines(tokensByLine) {
    let nextFallbackOffset = 0;
    return tokensByLine.map((tokens) => {
        const firstToken = tokens[0];
        const lastToken = tokens.at(-1);
        const idOffset = firstToken?.offset ?? nextFallbackOffset;
        if (lastToken) {
            nextFallbackOffset = lastToken.offset + lastToken.content.length + 1;
        }
        else {
            nextFallbackOffset += 1;
        }
        return {
            id: `line-${idOffset}`,
            tokens,
        };
    });
}
export function Textarea({ ref, variant = 'default', resize = 'vertical', highlightLanguage, className, value, onScroll, ...props }) {
    const textareaRef = useRef(null);
    const overlayRef = useRef(null);
    const [highlighter, setHighlighter] = useState(null);
    const textValue = getTextareaValue(value);
    const resolvedLanguage = highlightLanguage ? resolveLanguage(highlightLanguage) : undefined;
    useEffect(() => {
        if (!highlightLanguage)
            return;
        let active = true;
        getHighlighter()
            .then((loadedHighlighter) => {
            if (active) {
                setHighlighter(loadedHighlighter);
            }
        })
            .catch((loadError) => {
            if (!active) {
                return;
            }
            logger.warn('Failed to load syntax highlighter', {
                language: highlightLanguage,
                error: loadError instanceof Error ? loadError.message : String(loadError),
            });
        });
        return () => {
            active = false;
        };
    }, [highlightLanguage]);
    let highlightedLines = null;
    if (highlighter && resolvedLanguage && textValue.length > 0) {
        try {
            highlightedLines = getHighlightedLines(highlighter.codeToTokensBase(textValue, {
                lang: resolvedLanguage,
                theme: DEFAULT_THEME,
            }));
        }
        catch (highlightError) {
            logger.warn('Failed to render syntax highlight overlay', {
                language: resolvedLanguage,
                error: highlightError instanceof Error ? highlightError.message : String(highlightError),
            });
        }
    }
    useEffect(() => {
        syncOverlayScroll(textareaRef.current, overlayRef.current);
    });
    function handleRef(node) {
        textareaRef.current = node;
        assignRef(ref, node);
    }
    function handleScroll(event) {
        syncOverlayScroll(event.currentTarget, overlayRef.current);
        onScroll?.(event);
    }
    const textarea = (_jsx("textarea", { ref: handleRef, value: value, onScroll: handleScroll, className: cn(TEXTAREA_BASE_CLASS, TEXTAREA_VARIANT_CLASS[variant], TEXTAREA_RESIZE_CLASS[resize], highlightedLines && 'relative z-10 !bg-transparent !text-transparent caret-text-primary', className), ...props }));
    if (!highlightLanguage) {
        return textarea;
    }
    return (_jsxs("div", { className: "relative", children: [highlightedLines && (_jsx("pre", { ref: overlayRef, "aria-hidden": "true", className: cn('pointer-events-none absolute inset-0 z-0 m-0 overflow-hidden rounded-lg border border-transparent px-3 py-2 text-text-secondary', TEXTAREA_VARIANT_CLASS[variant]), children: _jsx("code", { className: cn('block', TEXTAREA_VARIANT_CLASS[variant]), children: highlightedLines.map((line) => (_jsx("span", { className: cn('block whitespace-pre', TEXTAREA_LINE_CLASS[variant]), children: line.tokens.map((token) => (_jsx("span", { style: getTokenStyle(token), children: token.content }, token.offset))) }, line.id))) }) })), textarea] }));
}
