import type {
  BrowserPreviewAutomationScrollInput,
  BrowserPreviewAutomationTypeInput,
  BrowserPreviewAutomationWaitInput,
} from '@shared/types/browser-preview-automation'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'

function json(value: string) {
  return JSON.stringify(value)
}

export function browserPreviewAutomationLocator(input: {
  readonly selector?: string
  readonly locator?: string
}) {
  return input.locator ?? (input.selector ? `css=${input.selector}` : null)
}

function resolveLocatorSource(locator: string | null, fallback: string, strict: boolean) {
  if (locator === null) return fallback
  return `(() => {
    const injected = globalThis.__openWagglePlaywrightInjected;
    return injected.querySelector(injected.parseSelector(${json(locator)}), document, ${String(strict)});
  })()`
}

export function browserPreviewSnapshotExpression() {
  return `(() => {
    const selectorFor = (element) => {
      if (element.id) return '#' + CSS.escape(element.id);
      for (const attribute of ['data-testid', 'name']) {
        const value = element.getAttribute(attribute);
        if (value) return element.tagName.toLowerCase() + '[' + attribute + '=' + JSON.stringify(value) + ']';
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
        const parent = current.parentElement;
        const siblings = parent
          ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
          : [];
        const base = current.tagName.toLowerCase();
        parts.unshift(siblings.length > 1 ? base + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : base);
        current = parent;
      }
      return parts.join(' > ');
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const interactiveElements = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,[role],[tabindex]'
    )).filter(visible).slice(0, ${String(BROWSER_PREVIEW_AUTOMATION_LIMITS.INTERACTIVE_ELEMENTS)}).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        name: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('name') || '').slice(0, 512),
        selector: selectorFor(element),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      url: location.href,
      title: document.title,
      loading: document.readyState !== 'complete',
      visibleText: (document.body?.innerText || '').slice(0, ${String(BROWSER_PREVIEW_AUTOMATION_LIMITS.VISIBLE_TEXT_LENGTH)}),
      interactiveElements,
    };
  })()`
}

export function browserPreviewClickPointExpression(locator: string) {
  return `(() => {
    try {
      const element = ${resolveLocatorSource(locator, 'null', true)};
      if (!element) return { kind: 'not-found' };
      const injected = globalThis.__openWagglePlaywrightInjected;
      if (!injected.elementState(element, 'visible').matches || !injected.elementState(element, 'enabled').matches) {
        return { kind: 'not-found' };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { kind: 'point', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    } catch (error) {
      return { kind: 'invalid-selector', message: String(error) };
    }
  })()`
}

export function browserPreviewTypeExpression(input: BrowserPreviewAutomationTypeInput) {
  const locator = browserPreviewAutomationLocator(input)
  return `(() => {
    try {
      const element = ${resolveLocatorSource(locator, 'document.activeElement', true)};
      if (!element) return { kind: 'not-found' };
      const blockedTypes = new Set(['button','checkbox','color','file','hidden','image','radio','range','reset','submit']);
      const textControl = element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && !blockedTypes.has(element.type));
      if ((!textControl && !element.isContentEditable) || element.disabled || element.readOnly) {
        return { kind: 'not-editable' };
      }
      element.focus();
      if (document.activeElement !== element) return { kind: 'not-editable' };
      const text = ${json(input.text)};
      const shouldClear = ${String(input.clear ?? false)};
      const shouldMutate = shouldClear || text.length > 0;
      try {
        let changed = true;
        if (textControl && shouldMutate) {
          const prototype = element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
          if (!descriptor || typeof descriptor.set !== 'function') return { kind: 'not-editable' };
          const currentValue = element.value;
          const selectionStart = element.selectionStart ?? currentValue.length;
          const selectionEnd = element.selectionEnd ?? selectionStart;
          const nextValue = shouldClear
            ? text
            : currentValue.slice(0, selectionStart) + text + currentValue.slice(selectionEnd);
          descriptor.set.call(element, nextValue);
          changed = element.value === nextValue;
        } else if (!textControl && shouldMutate) {
          if (shouldClear) {
            element.replaceChildren();
            if (element.textContent !== '') return { kind: 'not-editable' };
          }
          if (text.length > 0) {
            const selection = document.getSelection();
            let range = null;
            if (!shouldClear && selection && selection.rangeCount > 0) {
              const selectedRange = selection.getRangeAt(0);
              const ancestor = selectedRange.commonAncestorContainer;
              if (ancestor === element || element.contains(ancestor)) range = selectedRange;
            }
            if (!range) {
              range = document.createRange();
              range.selectNodeContents(element);
              range.collapse(false);
            }
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            changed = element.contains(textNode) && textNode.data === text;
            if (changed && selection) {
              range.setStartAfter(textNode);
              range.collapse(true);
              selection.removeAllRanges();
              selection.addRange(range);
            }
          }
        }
        if (!changed) return { kind: 'not-editable' };
        if (shouldMutate) {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { kind: 'ok' };
      } catch {
        return { kind: 'not-editable' };
      }
    } catch (error) {
      return { kind: 'invalid-selector', message: String(error) };
    }
  })()`
}

export function browserPreviewScrollExpression(input: BrowserPreviewAutomationScrollInput) {
  const locator = browserPreviewAutomationLocator(input)
  return `(() => {
    try {
      const target = ${resolveLocatorSource(locator, 'window', true)};
      if (!target) return { kind: 'not-found' };
      target.scrollBy({ left: ${String(input.deltaX ?? 0)}, top: ${String(input.deltaY ?? 0)}, behavior: 'instant' });
      return { kind: 'ok' };
    } catch (error) {
      return { kind: 'invalid-selector', message: String(error) };
    }
  })()`
}

export function browserPreviewWaitExpression(input: BrowserPreviewAutomationWaitInput) {
  const locator = browserPreviewAutomationLocator(input)
  const selectorMatch =
    locator === null ? 'true' : `${resolveLocatorSource(locator, 'null', false)} !== null`
  const textMatch =
    input.text === undefined
      ? 'true'
      : `(document.body?.innerText || '').includes(${json(input.text)})`
  const urlMatch =
    input.urlIncludes === undefined ? 'true' : `location.href.includes(${json(input.urlIncludes)})`
  return `(() => {
    try {
      return { kind: 'match', matched: ${selectorMatch} && ${textMatch} && ${urlMatch} };
    } catch (error) {
      return { kind: 'invalid-selector', message: String(error) };
    }
  })()`
}
