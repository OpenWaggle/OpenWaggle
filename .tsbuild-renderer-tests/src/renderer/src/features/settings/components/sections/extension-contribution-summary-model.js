function addFamilyCount(counts, family) {
    const existing = counts.find((entry) => entry.family === family);
    if (existing) {
        counts.splice(counts.indexOf(existing), 1, {
            family,
            count: existing.count + 1,
        });
        return;
    }
    counts.push({ family, count: 1 });
}
export function familyCountsFor(entries) {
    const counts = [];
    for (const entry of entries) {
        addFamilyCount(counts, entry.family);
    }
    return counts;
}
export function summarizePackageContributions(entries) {
    return {
        familyCounts: familyCountsFor(entries),
        totalCount: entries.length,
    };
}
