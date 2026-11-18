export const BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR = `
    const annotationRects = () => [
      ...Array.from(selected.values(), (target) => boundedRect(rectFromDomRect(target.element.getBoundingClientRect()))),
      ...regions.map((region) => region.rect),
      ...strokes.map((stroke) => stroke.bounds),
    ];
    const queueEditorLayout = () => {
      if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = null;
        if (editor.style.display === 'none') return;
        const bounds = unionRects(annotationRects(), 0);
        if (!bounds) return;
        const editorRect = editor.getBoundingClientRect();
        const margin = 8;
        const clamp = (position) => ({
          left: Math.min(Math.max(margin, position.left), Math.max(margin, window.innerWidth - editorRect.width - margin)),
          top: Math.min(Math.max(margin, position.top), Math.max(margin, window.innerHeight - editorRect.height - margin)),
        });
        let position = editorPosition;
        if (!editorExpanded || !position) {
          const candidates = [
            { left: bounds.x + bounds.width + margin, top: bounds.y },
            { left: bounds.x - editorRect.width - margin, top: bounds.y },
            { left: bounds.x + bounds.width - editorRect.width, top: bounds.y + bounds.height + margin },
            { left: bounds.x + bounds.width - editorRect.width, top: bounds.y - editorRect.height - margin },
          ];
          const overflow = (candidate) =>
            Math.max(0, -candidate.left) +
            Math.max(0, -candidate.top) +
            Math.max(0, candidate.left + editorRect.width - window.innerWidth) +
            Math.max(0, candidate.top + editorRect.height - window.innerHeight);
          position = candidates.reduce((best, candidate) =>
            overflow(candidate) < overflow(best) ? candidate : best,
          );
        }
        const applied = clamp(position);
        editor.style.left = String(applied.left) + 'px';
        editor.style.top = String(applied.top) + 'px';
        if (editorExpanded) editorPosition = applied;
      });
    };
    const updateStatus = (message = '') => {
      const count = selected.size + regions.length + strokes.length;
      const atLimit = selected.size >= MAX_ELEMENTS;
      status.textContent = message || (count === 0 ? 'Choose a target' : String(count) + ' target' + (count === 1 ? '' : 's'));
      status.classList.toggle('limit', atLimit || message.includes('limit'));
      editor.style.display = count > 0 ? 'block' : 'none';
      attachButton.disabled = count === 0;
      expandButton.disabled = selected.size === 0;
      stylePanel.setAttribute('data-has-elements', selected.size > 0 ? 'true' : 'false');
      queueEditorLayout();
      if (count > 0 && !editorWasShown) {
        editorWasShown = true;
        window.setTimeout(() => comment.focus({ preventScroll: true }), 0);
      }
    };
    const createTargetBox = () => {
      const node = document.createElement('div');
      node.className = 'box';
      node.style.zIndex = String(CONTENT_Z_INDEX);
      root.append(node);
      return node;
    };
    const createTargetLabel = () => {
      const node = document.createElement('div');
      node.className = 'target-label';
      node.style.zIndex = String(CONTENT_Z_INDEX);
      root.append(node);
      return node;
    };
    const updateSelectedVisual = (target) => {
      if (!target.element.isConnected) {
        target.outline.style.display = 'none';
        target.label.style.display = 'none';
        return;
      }
      const rect = boundedRect(rectFromDomRect(target.element.getBoundingClientRect()));
      positionBox(target.outline, rect);
      target.label.textContent = describeElement(target.element);
      target.label.style.display = 'block';
      target.label.style.transform = 'translate(' + String(Math.max(4, rect.x)) + 'px,' + String(Math.max(4, rect.y - 23)) + 'px)';
    };
    const restoreTargetStyles = (target) => {
      if (!(target.element instanceof HTMLElement || target.element instanceof SVGElement)) return;
      for (const [property, baseline] of target.baselineStyles) {
        if (baseline.value) target.element.style.setProperty(property, baseline.value, baseline.priority);
        else target.element.style.removeProperty(property);
      }
    };
    const removeSelected = (target) => {
      restoreTargetStyles(target);
      selected.delete(target.element);
      target.outline.remove();
      target.label.remove();
      for (const [key, change] of styleChanges) {
        if (change.targetId === target.id) styleChanges.delete(key);
      }
      updateStatus();
    };
    const addSelected = (element) => {
      if (selected.has(element)) return true;
      if (selected.size >= MAX_ELEMENTS) {
        updateStatus('20 element limit');
        return false;
      }
      const target = {
        id: nextId('element'),
        element,
        outline: createTargetBox(),
        label: createTargetLabel(),
        baselineStyles: new Map(),
      };
      selected.set(element, target);
      updateSelectedVisual(target);
      updateStatus();
      syncStyleControls();
      return true;
    };
    const clearSelected = () => {
      for (const target of Array.from(selected.values())) removeSelected(target);
    };
    const toggleSelected = (element, additive) => {
      const existing = selected.get(element);
      if (existing) {
        removeSelected(existing);
        return;
      }
      if (!additive) clearSelected();
      addSelected(element);
    };
    const setStyleForSelected = (property, rawValue) => {
      if (!STYLE_PROPERTIES.includes(property)) return;
      const value = cleanText(rawValue, MAX_STYLE_VALUE);
      if (!value) return;
      for (const target of selected.values()) {
        if (!(target.element instanceof HTMLElement || target.element instanceof SVGElement)) continue;
        if (!target.baselineStyles.has(property)) {
          target.baselineStyles.set(property, {
            value: target.element.style.getPropertyValue(property),
            priority: target.element.style.getPropertyPriority(property),
          });
        }
        const key = target.id + ':' + property;
        const existingChange = styleChanges.get(key);
        const previousValue = existingChange
          ? existingChange.previousValue
          : getComputedStyle(target.element).getPropertyValue(property).trim();
        target.element.style.setProperty(property, value, 'important');
        const applied = target.element.style.getPropertyValue(property).trim();
        if (!applied) continue;
        styleChanges.set(key, {
          targetId: target.id,
          selector: selectorFor(target.element),
          property,
          previousValue: cleanText(previousValue, MAX_STYLE_VALUE),
          value: cleanText(applied, MAX_STYLE_VALUE),
        });
        updateSelectedVisual(target);
      }
      updateStatus();
    };
`
