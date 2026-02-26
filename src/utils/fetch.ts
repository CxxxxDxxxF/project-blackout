export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err) {
      if (attempt >= maxRetries) throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Unreachable: loop either returns a Response or throws.
  throw new Error('fetchWithTimeout: unreachable');
}
