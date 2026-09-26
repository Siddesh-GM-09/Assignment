export function countdownParts(startUtc: string, now = Date.now()) {
  const start = Date.parse(startUtc);
  const remainingMilliseconds = Number.isFinite(start) ? Math.max(0, start - now) : 0;
  const remainingSeconds = Math.floor(remainingMilliseconds / 1000);
  return {
    remainingMilliseconds,
    days: Math.floor(remainingSeconds / 86_400),
    hours: Math.floor((remainingSeconds % 86_400) / 3_600),
    minutes: Math.floor((remainingSeconds % 3_600) / 60),
    seconds: remainingSeconds % 60,
  };
}
