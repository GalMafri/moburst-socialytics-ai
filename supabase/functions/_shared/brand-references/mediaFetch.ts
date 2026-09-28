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
