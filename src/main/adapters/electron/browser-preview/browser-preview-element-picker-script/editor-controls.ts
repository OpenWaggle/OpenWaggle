export const BROWSER_PREVIEW_ELEMENT_PICKER_EDITOR_CONTROLS = String.raw`
    const createSection = () => {
      const section = document.createElement('section');
      section.className = 'style-section';
      stylePanel.append(section);
      return section;
    };
    const createField = (labelText, control, section) => {
      const row = document.createElement('label');
      row.className = 'field';
      const label = document.createElement('span');
      label.textContent = labelText;
      control.setAttribute('aria-label', labelText);
      row.append(label, control);
      section.append(row);
      return control;
    };
    const createTextInput = (maxLength = MAX_STYLE_VALUE) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = maxLength;
      return input;
    };
    const createNumberInput = (min, max) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      return input;
    };
    const inputNumber = (input, minimum) => {
      const value = Number(input.value);
      return Number.isFinite(value) && value >= minimum ? value : null;
    };
    const createSelect = (values) => {
      const select = document.createElement('select');
      for (const value of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
      return select;
    };
    const createColorControl = (labelText, property, section) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'color-control';
      const color = document.createElement('input');
      color.type = 'color';
      color.setAttribute('aria-label', labelText + ' picker');
      const text = createTextInput(64);
      text.setAttribute('aria-label', labelText);
      color.addEventListener('input', () => {
        text.value = color.value;
        setStyleForSelected(property, color.value);
      });
      text.addEventListener('change', () => {
        setStyleForSelected(property, text.value);
        if (/^#[0-9a-f]{6}$/iu.test(text.value.trim())) color.value = text.value.trim();
      });
      wrapper.append(color, text);
      createField(labelText, wrapper, section);
      return { color, text };
    };

    const typography = createSection();
    const fontFamily = createSelect(['inherit', 'system-ui', 'sans-serif', 'serif', 'monospace']);
    fontFamily.addEventListener('change', () => setStyleForSelected('font-family', fontFamily.value));
    createField('Font', fontFamily, typography);
    const fontSize = createNumberInput(1, 300);
    fontSize.addEventListener('input', () => {
      const value = inputNumber(fontSize, 1);
      if (value !== null) setStyleForSelected('font-size', String(value) + 'px');
    });
    createField('Font size (px)', fontSize, typography);
    const fontWeight = createSelect(['300', '400', '500', '600', '700', '800', '900']);
    fontWeight.addEventListener('change', () => setStyleForSelected('font-weight', fontWeight.value));
    createField('Font weight', fontWeight, typography);
    const lineHeight = createTextInput(64);
    lineHeight.addEventListener('change', () => setStyleForSelected('line-height', lineHeight.value));
    createField('Line height', lineHeight, typography);

    const colors = createSection();
    const textColor = createColorControl('Text color', 'color', colors);
    const backgroundColor = createColorControl('Background', 'background-color', colors);
    const opacity = document.createElement('input');
    opacity.type = 'range';
    opacity.min = '0';
    opacity.max = '1';
    opacity.step = '0.05';
    opacity.value = '1';
    opacity.addEventListener('input', () => setStyleForSelected('opacity', opacity.value));
    createField('Opacity', opacity, colors);

    const borders = createSection();
    const radius = createNumberInput(0, 300);
    radius.addEventListener('input', () => {
      const value = inputNumber(radius, 0);
      if (value !== null) setStyleForSelected('border-radius', String(value) + 'px');
    });
    createField('Radius (px)', radius, borders);
    const borderColor = createColorControl('Border color', 'border-color', borders);
    const borderWidth = createNumberInput(0, 100);
    borderWidth.addEventListener('input', () => {
      const value = inputNumber(borderWidth, 0);
      if (value === null) return;
      setStyleForSelected('border-style', 'solid');
      setStyleForSelected('border-width', String(value) + 'px');
    });
    createField('Border (px)', borderWidth, borders);

    const layout = createSection();
    let aspectLocked = true;
    let aspectRatio = 1;
    const width = createNumberInput(1, 10000);
    const height = createNumberInput(1, 10000);
    const aspectLock = document.createElement('button');
    const refreshAspectLock = () => {
      aspectLock.textContent = aspectLocked ? 'Aspect locked' : 'Aspect free';
      aspectLock.title = aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio';
      aspectLock.setAttribute('aria-label', aspectLock.title);
      aspectLock.setAttribute('aria-pressed', aspectLocked ? 'true' : 'false');
    };
    aspectLock.type = 'button';
    aspectLock.className = 'tool';
    aspectLock.addEventListener('click', () => {
      aspectLocked = !aspectLocked;
      refreshAspectLock();
    });
    width.addEventListener('input', () => {
      const value = inputNumber(width, 1);
      if (value === null) return;
      setStyleForSelected('width', String(value) + 'px');
      if (!aspectLocked || aspectRatio <= 0) return;
      const pairedValue = Math.max(1, Math.round(value / aspectRatio));
      height.value = String(pairedValue);
      setStyleForSelected('height', String(pairedValue) + 'px');
    });
    height.addEventListener('input', () => {
      const value = inputNumber(height, 1);
      if (value === null) return;
      setStyleForSelected('height', String(value) + 'px');
      if (!aspectLocked || aspectRatio <= 0) return;
      const pairedValue = Math.max(1, Math.round(value * aspectRatio));
      width.value = String(pairedValue);
      setStyleForSelected('width', String(pairedValue) + 'px');
    });
    createField('Width (px)', width, layout);
    createField('Height (px)', height, layout);
    layout.append(aspectLock);
    refreshAspectLock();
    const padding = createTextInput();
    padding.addEventListener('change', () => setStyleForSelected('padding', padding.value));
    createField('Padding', padding, layout);
    const margin = createTextInput();
    margin.addEventListener('change', () => setStyleForSelected('margin', margin.value));
    createField('Margin', margin, layout);
    const gap = createTextInput();
    gap.addEventListener('change', () => setStyleForSelected('gap', gap.value));
    createField('Gap', gap, layout);

    function syncStyleControls() {
      const first = selected.values().next().value;
      if (!first) return;
      const computed = getComputedStyle(first.element);
      const rect = first.element.getBoundingClientRect();
      aspectRatio = rect.height > 0 ? rect.width / rect.height : 1;
      fontFamily.value = Array.from(fontFamily.options).some((option) => option.value === computed.fontFamily)
        ? computed.fontFamily
        : 'inherit';
      fontSize.value = String(Math.max(1, Math.round(Number.parseFloat(computed.fontSize) || 16)));
      fontWeight.value = /^\d+$/u.test(computed.fontWeight) ? computed.fontWeight : '400';
      lineHeight.value = computed.lineHeight;
      textColor.text.value = computed.color;
      backgroundColor.text.value = computed.backgroundColor;
      borderColor.text.value = computed.borderColor;
      opacity.value = computed.opacity;
      radius.value = String(Math.max(0, Math.round(Number.parseFloat(computed.borderRadius) || 0)));
      borderWidth.value = String(Math.max(0, Math.round(Number.parseFloat(computed.borderWidth) || 0)));
      width.value = String(Math.max(1, Math.round(rect.width)));
      height.value = String(Math.max(1, Math.round(rect.height)));
      padding.value = computed.padding;
      margin.value = computed.margin;
      gap.value = computed.gap === 'normal' ? '0px' : computed.gap;
    }

`
