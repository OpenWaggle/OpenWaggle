export const BROWSER_PREVIEW_ELEMENT_PICKER_CONTEXT = String.raw`
    const cleanText = (value, maxLength) =>
      String(value || '').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
    const cleanMultiline = (value, maxLength) =>
      String(value || '').replace(/\r\n?/gu, '\n').trim().slice(0, maxLength);
    const finiteNumber = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    const nextId = (prefix) => {
      idSequence += 1;
      return prefix + '_' + idSequence.toString(36);
    };
    const escapeCss = (value) => {
      if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(String(value));
      return String(value).replace(/[^a-zA-Z0-9_-]/gu, (character) => '\\' + character);
    };
    const rectFromDomRect = (rect) => ({
      x: Math.max(0, finiteNumber(rect.left)),
      y: Math.max(0, finiteNumber(rect.top)),
      width: Math.max(1, finiteNumber(rect.width, 1)),
      height: Math.max(1, finiteNumber(rect.height, 1)),
    });
    const normalizeRect = (start, end) => ({
      x: Math.max(0, Math.min(start.x, end.x)),
      y: Math.max(0, Math.min(start.y, end.y)),
      width: Math.max(1, Math.abs(end.x - start.x)),
      height: Math.max(1, Math.abs(end.y - start.y)),
    });
    const pointInRect = (point, rect) =>
      point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
    const boundedPoint = (point) => ({
      x: Math.max(0, Math.min(finiteNumber(point.x), Math.max(1, window.innerWidth))),
      y: Math.max(0, Math.min(finiteNumber(point.y), Math.max(1, window.innerHeight))),
    });
    const boundedRect = (rect) => {
      const viewportWidth = Math.max(1, window.innerWidth);
      const viewportHeight = Math.max(1, window.innerHeight);
      const x = Math.max(0, Math.min(finiteNumber(rect.x), viewportWidth - 1));
      const y = Math.max(0, Math.min(finiteNumber(rect.y), viewportHeight - 1));
      const right = Math.max(x + 1, Math.min(finiteNumber(rect.x + rect.width, x + 1), viewportWidth));
      const bottom = Math.max(y + 1, Math.min(finiteNumber(rect.y + rect.height, y + 1), viewportHeight));
      return { x, y, width: right - x, height: bottom - y };
    };
    const unionRects = (rects, padding = CAPTURE_PADDING) => {
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((rect) => rect.x));
      const top = Math.min(...rects.map((rect) => rect.y));
      const right = Math.max(...rects.map((rect) => rect.x + rect.width));
      const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
      return boundedRect({
        x: left - padding,
        y: top - padding,
        width: right - left + padding * 2,
        height: bottom - top + padding * 2,
      });
    };
    const positionBox = (node, rect) => {
      const bounded = boundedRect(rect);
      node.style.display = 'block';
      node.style.transform = 'translate(' + String(bounded.x) + 'px,' + String(bounded.y) + 'px)';
      node.style.width = String(bounded.width) + 'px';
      node.style.height = String(bounded.height) + 'px';
    };
    const isOverlayEvent = (event) => event.composedPath().includes(host);
    const targetAt = (x, y) => {
      const candidates = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)];
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        if (candidate === host || candidate === document.documentElement || candidate === document.body) continue;
        return candidate;
      }
      return null;
    };
    const selectorFor = (element) => {
      if (element.id) return ('#' + escapeCss(element.id)).slice(0, MAX_SELECTOR);
      const parts = [];
      let current = element;
      while (current instanceof Element && parts.length < 8) {
        const tag = current.tagName.toLowerCase();
        let part = tag;
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === current.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + String(siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        if (tag === 'body' || tag === 'html') break;
        current = parent;
      }
      return (parts.join(' > ') || element.tagName.toLowerCase()).slice(0, MAX_SELECTOR);
    };
    const describeElement = (element) => {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? '#' + cleanText(element.id, 80) : '';
      const classes = Array.from(element.classList).slice(0, 2).map((name) => '.' + cleanText(name, 60)).join('');
      return cleanText(tag + id + classes, 280);
    };
    const sourceFrame = (functionName, fileName, lineNumber, columnNumber) => ({
      functionName: cleanText(functionName, MAX_COMPONENT) || null,
      fileName: cleanText(fileName, MAX_SOURCE) || null,
      lineNumber: Number.isFinite(lineNumber) && lineNumber > 0 && lineNumber <= MAX_SOURCE_POSITION
        ? Math.floor(lineNumber)
        : null,
      columnNumber: Number.isFinite(columnNumber) && columnNumber > 0 && columnNumber <= MAX_SOURCE_POSITION
        ? Math.floor(columnNumber)
        : null,
    });
    const parseSource = (value, functionName = null) => {
      const text = cleanText(value, MAX_SOURCE);
      const match = /^(.*?):(\d+)(?::(\d+))?$/u.exec(text);
      if (!match) return text ? sourceFrame(functionName, text, null, null) : null;
      return sourceFrame(functionName, match[1], Number(match[2]), match[3] ? Number(match[3]) : null);
    };
    const parseStack = (value) => {
      const frames = [];
      const lines = String(value || '').split('\n').slice(0, MAX_STACK_FRAMES * 2);
      for (const line of lines) {
        const match = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/u.exec(line);
        if (!match) continue;
        frames.push(sourceFrame(match[1], match[2], Number(match[3]), Number(match[4])));
        if (frames.length >= MAX_STACK_FRAMES) break;
      }
      return frames;
    };
    const namedType = (value) => {
      if (typeof value === 'function') return cleanText(value.displayName || value.name, MAX_COMPONENT) || null;
      if (value && typeof value === 'object') {
        const candidate = value.displayName || value.name || value.render?.displayName || value.render?.name;
        return cleanText(candidate, MAX_COMPONENT) || null;
      }
      return null;
    };
    const attributeAttribution = (element) => {
      let current = element;
      for (let depth = 0; current instanceof Element && depth < 8; depth += 1) {
        const componentName = cleanText(
          current.getAttribute('data-component') ||
            current.getAttribute('data-component-name') ||
            current.getAttribute('data-react-component'),
          MAX_COMPONENT,
        ) || null;
        const fileName = cleanText(
          current.getAttribute('data-source-file') || current.getAttribute('data-file-name'),
          MAX_SOURCE,
        );
        const sourceValue = current.getAttribute('data-source') || current.getAttribute('data-loc');
        const lineNumber = Number(current.getAttribute('data-source-line'));
        const columnNumber = Number(current.getAttribute('data-source-column'));
        const source = fileName
          ? sourceFrame(componentName, fileName, lineNumber, columnNumber)
          : parseSource(sourceValue, componentName);
        if (componentName || source) return { componentName, source, stack: source ? [source] : [] };
        current = current.parentElement;
      }
      return { componentName: null, source: null, stack: [] };
    };
    const reactAttribution = (element) => {
      try {
        const property = Object.getOwnPropertyNames(element).find((name) =>
          name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'),
        );
        if (!property) return null;
        let fiber = element[property];
        const stack = [];
        let componentName = null;
        const seen = new Set();
        for (let depth = 0; fiber && typeof fiber === 'object' && depth < 32; depth += 1) {
          if (seen.has(fiber)) break;
          seen.add(fiber);
          const name = namedType(fiber.elementType) || namedType(fiber.type);
          if (name && !componentName) componentName = name;
          const debugSource = fiber._debugSource;
          if (debugSource && typeof debugSource === 'object') {
            stack.push(sourceFrame(name, debugSource.fileName, debugSource.lineNumber, debugSource.columnNumber));
          } else if (fiber._debugStack && fiber._debugStack.stack) {
            for (const frame of parseStack(fiber._debugStack.stack)) stack.push(frame);
          }
          if (stack.length >= MAX_STACK_FRAMES) break;
          fiber = fiber._debugOwner || fiber.return;
        }
        const boundedStack = stack
          .filter((frame) => frame.fileName || frame.functionName)
          .filter((frame, index, frames) =>
            index === frames.findIndex((candidate) =>
              candidate.fileName === frame.fileName &&
              candidate.lineNumber === frame.lineNumber &&
              candidate.columnNumber === frame.columnNumber &&
              candidate.functionName === frame.functionName,
            ),
          )
          .slice(0, MAX_STACK_FRAMES);
        if (!componentName && boundedStack.length === 0) return null;
        return { componentName, source: boundedStack[0] || null, stack: boundedStack };
      } catch {
        return null;
      }
    };
    const attributionFor = (element) => reactAttribution(element) || attributeAttribution(element);
    const styleSnapshot = (element) => {
      try {
        const computed = getComputedStyle(element);
        const lines = CONTEXT_STYLE_PROPERTIES.map(
          (property) => property + ': ' + computed.getPropertyValue(property).trim() + ';',
        );
        const inline = element.getAttribute('style');
        if (inline) lines.unshift('inline: ' + cleanMultiline(inline, MAX_STYLE_VALUE));
        return cleanMultiline(lines.join('\n'), MAX_STYLES);
      } catch {
        return '';
      }
    };
    const contextFor = (element) => {
      const text = cleanText(element.innerText || element.textContent, MAX_TEXT);
      const accessibleName = cleanText(
        element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || text,
        MAX_TEXT,
      );
      const attribution = attributionFor(element);
      return {
        selector: selectorFor(element),
        tagName: element.tagName.toLowerCase().slice(0, 64),
        id: element.id ? cleanText(element.id, 512) : null,
        classes: Array.from(element.classList, (name) => cleanText(name, 128)).filter(Boolean).slice(0, 16),
        role: cleanText(element.getAttribute('role'), 128) || null,
        accessibleName: accessibleName || null,
        text,
        rect: boundedRect(rectFromDomRect(element.getBoundingClientRect())),
        htmlPreview: cleanMultiline(element.outerHTML, MAX_HTML),
        componentName: attribution.componentName,
        source: attribution.source,
        stack: attribution.stack,
        styles: styleSnapshot(element),
        pickedAt: new Date().toISOString(),
      };
    };
`
