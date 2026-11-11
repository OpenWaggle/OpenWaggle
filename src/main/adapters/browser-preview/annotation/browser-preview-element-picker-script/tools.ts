export const BROWSER_PREVIEW_ELEMENT_PICKER_TOOLS = `
    const toolDefinitions = [
      ['select', 'Select', 'Select elements (V)'],
      ['marquee', 'Region', 'Select a region or mark an empty area (R)'],
      ['draw', 'Draw', 'Draw freehand (D)'],
      ['erase', 'Erase', 'Remove a target (E)'],
    ];
    const refreshTool = () => {
      for (const [candidate, button] of toolButtons) {
        button.setAttribute('aria-pressed', candidate === tool ? 'true' : 'false');
      }
      drawOptions.setAttribute('data-visible', tool === 'draw' ? 'true' : 'false');
      if (tool !== 'select') hoverBox.style.display = 'none';
      if (tool !== 'marquee') marqueeBox.style.display = 'none';
      document.documentElement.setAttribute('data-openwaggle-annotation-tool', tool);
    };
    for (const [candidate, label, title] of toolDefinitions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool';
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('click', () => {
        tool = candidate;
        refreshTool();
      });
      toolButtons.set(candidate, button);
      toolbar.append(button);
    }
    toolbar.append(drawOptions, toolbarSeparator, status, cancelButton);

    const removeTargetAtPoint = (point) => {
      const selectedTargets = Array.from(selected.values());
      for (let index = selectedTargets.length - 1; index >= 0; index -= 1) {
        const target = selectedTargets[index];
        if (pointInRect(point, boundedRect(rectFromDomRect(target.element.getBoundingClientRect())))) {
          removeSelected(target);
          return true;
        }
      }
      for (let index = regions.length - 1; index >= 0; index -= 1) {
        if (!pointInRect(point, regions[index].rect)) continue;
        const removed = regions.splice(index, 1)[0];
        targetNodes.get(removed.id)?.remove();
        targetNodes.delete(removed.id);
        updateStatus();
        return true;
      }
      for (let index = strokes.length - 1; index >= 0; index -= 1) {
        if (!pointInRect(point, strokes[index].bounds)) continue;
        const removed = strokes.splice(index, 1)[0];
        targetNodes.get(removed.id)?.remove();
        targetNodes.delete(removed.id);
        updateStatus();
        return true;
      }
      return false;
    };
    const addRegion = (rect) => {
      if (regions.length >= MAX_REGIONS) {
        updateStatus('20 region limit');
        return;
      }
      const region = { id: nextId('region'), rect: boundedRect(rect) };
      regions.push(region);
      const node = createTargetBox();
      node.style.background = 'rgba(37,99,235,.07)';
      node.setAttribute('data-region-id', region.id);
      positionBox(node, region.rect);
      targetNodes.set(region.id, node);
    };
    const marqueeCandidates = (rect) => {
      const candidates = new Map();
      const columns = Math.max(2, Math.min(14, Math.ceil(rect.width / 42)));
      const rows = Math.max(2, Math.min(14, Math.ceil(rect.height / 42)));
      const sampleCount = Math.min(MAX_MARQUEE_SAMPLES, columns * rows);
      for (let index = 0; index < sampleCount && candidates.size < MAX_MARQUEE_CANDIDATES; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = rect.x + ((column + 0.5) / columns) * rect.width;
        const y = rect.y + ((row + 0.5) / rows) * rect.height;
        const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
        for (const element of stack) {
          if (!(element instanceof Element) || element === document.body || element === document.documentElement || element === host) continue;
          let current = element;
          for (let depth = 0; current instanceof Element && depth < 4; depth += 1) {
            if (current !== document.body && current !== document.documentElement) {
              candidates.set(current, current.getBoundingClientRect());
            }
            current = current.parentElement;
          }
          if (candidates.size >= MAX_MARQUEE_CANDIDATES) break;
        }
      }
      return Array.from(candidates, ([element, candidate]) => ({ element, rect: candidate }))
        .filter(({ rect: candidate }) => candidate.width >= 2 && candidate.height >= 2)
        .filter(({ element, rect: candidate }) => {
          const center = { x: candidate.left + candidate.width / 2, y: candidate.top + candidate.height / 2 };
          return pointInRect(center, rect) && (
            element.children.length === 0 ||
            element instanceof HTMLButtonElement ||
            element instanceof HTMLAnchorElement ||
            element.getAttribute('role') === 'button'
          );
        })
        .sort((left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height);
    };
    const selectElementsInRect = (rect) => {
      let added = 0;
      for (const candidate of marqueeCandidates(rect)) {
        if (selected.size >= MAX_ELEMENTS) break;
        if (!selected.has(candidate.element) && addSelected(candidate.element)) added += 1;
      }
      return added;
    };
    const pathFromPoints = (points) => {
      if (points.length === 0) return '';
      if (points.length === 1) return 'M ' + String(points[0].x) + ' ' + String(points[0].y) + ' l .01 .01';
      let path = 'M ' + String(points[0].x) + ' ' + String(points[0].y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        path += ' Q ' + String(current.x) + ' ' + String(current.y) + ' ' + String((current.x + next.x) / 2) + ' ' + String((current.y + next.y) / 2);
      }
      const last = points[points.length - 1];
      return path + ' L ' + String(last.x) + ' ' + String(last.y);
    };
    const strokeBounds = (points, widthValue) => {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const paddingValue = widthValue + 3;
      const left = Math.min(...xs) - paddingValue;
      const top = Math.min(...ys) - paddingValue;
      const right = Math.max(...xs) + paddingValue;
      const bottom = Math.max(...ys) + paddingValue;
      return boundedRect({ x: left, y: top, width: right - left, height: bottom - top });
    };
    const appendStrokePoint = (stroke, point) => {
      point = boundedPoint(point);
      const previousPoint = stroke.points[stroke.points.length - 1];
      const distance = previousPoint ? Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) : Infinity;
      if (distance < MIN_POINT_DISTANCE) return;
      if (stroke.points.length < MAX_STROKE_POINTS) stroke.points.push(point);
      else stroke.points[stroke.points.length - 1] = point;
      stroke.bounds = strokeBounds(stroke.points, stroke.width);
    };
    const beginStroke = (point) => {
      if (strokes.length >= MAX_STROKES) {
        updateStatus('20 drawing limit');
        return;
      }
      const firstPoint = boundedPoint(point);
      const stroke = {
        id: nextId('stroke'),
        color: cleanText(drawColor, 64),
        width: drawWidth,
        points: [firstPoint],
        bounds: boundedRect({ x: firstPoint.x, y: firstPoint.y, width: 1, height: 1 }),
      };
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('data-stroke-id', stroke.id);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', stroke.color);
      path.setAttribute('stroke-width', String(stroke.width));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.append(path);
      targetNodes.set(stroke.id, path);
      activeStroke = { target: stroke, path };
    };
    const repaint = () => {
      svg.setAttribute('viewBox', '0 0 ' + String(Math.max(1, window.innerWidth)) + ' ' + String(Math.max(1, window.innerHeight)));
      for (const target of selected.values()) updateSelectedVisual(target);
      queueEditorLayout();
    };
`
