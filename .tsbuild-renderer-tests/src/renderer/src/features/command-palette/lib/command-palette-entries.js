export function buildCommandPaletteEntries(items) {
    const entries = [];
    let lastSection;
    items.forEach((item, index) => {
        const isConfigureSection = item.section === 'configure';
        const shouldShowSectionHeader = item.section && !isConfigureSection && item.section !== lastSection;
        const shouldShowSeparator = isConfigureSection && lastSection !== 'configure';
        if (shouldShowSectionHeader) {
            entries.push({
                type: 'section',
                key: `section-${item.section}-${index}`,
                label: item.section,
            });
        }
        if (shouldShowSeparator) {
            entries.push({ type: 'separator', key: `separator-${index}` });
        }
        entries.push({ type: 'item', key: item.id, item, index });
        lastSection = item.section;
    });
    return entries;
}
