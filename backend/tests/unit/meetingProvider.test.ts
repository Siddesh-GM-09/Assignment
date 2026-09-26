import { describe, expect, it } from 'vitest';
import { InternalClassroomProvider } from '../../src/services/meetingProvider.js';

describe('internal classroom provider', () => {
  it('creates distinct private URLs per booking without using a shared video URL', () => {
    const provider = new InternalClassroomProvider('https://classes.codeyoung.test');
    const first = provider.createRoom('first-random-booking-token');
    const second = provider.createRoom('second-random-booking-token');
    expect(first.provider).toBe('INTERNAL_CLASSROOM');
    expect(first.url).toBe('https://classes.codeyoung.test/class/first-random-booking-token');
    expect(first.url).not.toBe(second.url);
    expect(first.url).not.toContain('meet.google.com');
  });

  it('rejects insecure non-local classroom origins', () => {
    expect(() => new InternalClassroomProvider('http://classes.example.com')).toThrow();
    expect(() => new InternalClassroomProvider('javascript:alert(1)')).toThrow();
  });
});
