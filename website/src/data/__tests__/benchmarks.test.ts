import { describe, expect, it } from 'vitest';
import { benchmarkRun, openwaggleBuild } from '../benchmarks';

describe('token benchmark data', () => {
  it('names the OpenWaggle build it measured', () => {
    expect(openwaggleBuild.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(openwaggleBuild.appVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('describes the OpenWaggle row as excluding both of its title calls', () => {
    const openwaggle = benchmarkRun.entry.find((candidate) => candidate.id === 'openwaggle');
    expect(openwaggle?.notes.join(' ')).toMatch(/two other model calls/);
  });
});
