export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

export function rateLimitBackoffMs(response, previousBackoffMs = 0) {
  const status = Number(response?.status || 0);
  const headers = response?.headers || {};

  if (status === 429) {
    const retryAfter = Number(headers.retryAfter || headers["retry-after"] || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(Math.max(retryAfter * 1000, 60_000), 30 * 60_000);
    }

    const reset = Number(headers.rateLimitReset || headers["x-rate-limit-reset"] || 0);
    if (Number.isFinite(reset) && reset > 0) {
      const wait = reset * 1000 - Date.now() + 2000;
      return Math.min(Math.max(wait, 60_000), 30 * 60_000);
    }

    return Math.min(previousBackoffMs ? previousBackoffMs * 2 : 60_000, 30 * 60_000);
  }

  if (status === 402) return 10 * 60_000;
  if (status >= 500 || status === 408) return Math.min(previousBackoffMs ? previousBackoffMs * 2 : 30_000, 10 * 60_000);
  return 0;
}
