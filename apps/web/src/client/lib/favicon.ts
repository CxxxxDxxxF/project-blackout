import accomplishFavicon from '/assets/accomplish-favicon.png';

function normalizeHost(domain: string): string {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith('[') && trimmed.includes(']')) {
    return trimmed.slice(1, trimmed.indexOf(']'));
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex > -1) {
    return trimmed.slice(0, colonIndex);
  }

  return trimmed;
}

function isLocalOrPrivateHost(host: string): boolean {
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1'
  ) {
    return true;
  }

  if (host.startsWith('10.') || host.startsWith('192.168.')) {
    return true;
  }

  const secondOctet = /^172\.(\d+)\./.exec(host)?.[1];
  if (secondOctet) {
    const value = Number(secondOctet);
    if (value >= 16 && value <= 31) {
      return true;
    }
  }

  return false;
}

export function getDomainFaviconSrc(domain: string, size: number): string {
  const host = normalizeHost(domain);
  if (!host || isLocalOrPrivateHost(host)) {
    return accomplishFavicon;
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}
