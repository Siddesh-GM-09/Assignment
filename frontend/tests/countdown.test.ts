import { describe, expect, it } from 'vitest';
import { countdownParts } from '../src/utils/countdown';

describe('absolute countdown calculation', () => {
  it('uses UTC instants and returns whole day/hour/minute/second units', () => {
    const start = Date.parse('2026-09-30T06:30:00.000Z');
    expect(countdownParts('2026-09-30T06:30:00.000Z', start - 90_061_000)).toMatchObject({
      days: 1, hours: 1, minutes: 1, seconds: 1,
    });
  });

  it('clamps expired and invalid timestamps to zero', () => {
    expect(countdownParts('2026-09-30T06:30:00.000Z', Date.parse('2026-09-30T06:30:01.000Z'))).toMatchObject({ remainingMilliseconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownParts('not-a-date')).toMatchObject({ remainingMilliseconds: 0, days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});
