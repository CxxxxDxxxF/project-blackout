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
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (!response) {
        throw new Error('Fetch returned no response');
      }

      return response;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }

      if (attempt >= maxRetries) throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Unreachable: loop either returns a Response or throws.
  throw new Error('fetchWithTimeout: unreachable');
}
