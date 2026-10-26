import { describe, expect, it } from 'vitest';
import { releaseStageLabel } from '../release-stage';

describe('releaseStageLabel', () => {
  it.each([
    ['1.0.0-beta.25', 'Beta'],
    ['1.0.0-rc.1', 'Release candidate'],
    ['2.0.0-alpha.3', 'Alpha'],
  ])('labels prerelease %s as %s', (version, label) => {
    expect(releaseStageLabel(version)).toBe(label);
  });

  it.each(['1.0.0', '1.2.3', '1.0.0+build.7'])('shows no stage for the Stable version %s', (version) => {
    expect(releaseStageLabel(version)).toBeUndefined();
  });

  it.each(['1.0.0-next.1', 'not-a-version', '1.0', '1.0.0-'])('fails the build for %s instead of guessing', (version) => {
    expect(() => releaseStageLabel(version)).toThrow(/release stage/u);
  });
});
