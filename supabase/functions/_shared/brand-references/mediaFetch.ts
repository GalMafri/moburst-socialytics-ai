/** Follow the provider's media redirects, validating every hop before sending a request. */
export function allowedMediaUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !/\.(fbcdn\.net|cdninstagram\.com|licdn\.com|twimg\.com|sproutsocial\.com|cloudfront\.net|amazonaws\.com)$/.test(url.hostname)) {
    throw new Error('Unsupported social media host');
  }
  return url;
}
export async function fetchSocialImage(value: string, send: typeof fetch = fetch): Promise<Response> {
  let url = allowedMediaUrl(value);
  const signal = AbortSignal.timeout(10000);
  for (let hop = 0; hop < 4; hop++) {
    const response = await send(url.href, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Media redirect has no destination');
    url = allowedMediaUrl(new URL(location, url).href);
  }
  throw new Error('Too many media redirects');
}

/**
 * Where generated media may be fetched from: our own storage (the video
 * generator hands back a storage link) and the generation provider's HTTPS
 * CDN. Every other host is refused, including one reached by a redirect.
 */
export function allowedGeneratedMediaUrl(value: string, ownHost: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(host === ownHost.toLowerCase() || host.endsWith('.cloudfront.net'))) {
    throw new Error('Unsupported media host');
  }
  return url;
}
export async function fetchGeneratedMedia(value: string, ownHost: string, send: typeof fetch = fetch): Promise<Response> {
  let url = allowedGeneratedMediaUrl(value, ownHost);
  const signal = AbortSignal.timeout(30000);
  for (let hop = 0; hop < 4; hop++) {
    const response = await send(url.href, { redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Media redirect has no destination');
    url = allowedGeneratedMediaUrl(new URL(location, url).href, ownHost);
  }
  throw new Error('Too many media redirects');
}
