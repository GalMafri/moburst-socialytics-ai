import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fetchSocialImage } from '../../supabase/functions/_shared/brand-references/mediaFetch';
// jsdom predates AbortSignal.timeout; requests are mocked in these redirect tests.
beforeEach(() => vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal }));
afterEach(() => vi.unstubAllGlobals());
it('follows Sprout media redirects to the public social CDN', async () => {
  const send = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://scontent.cdninstagram.com/photo.jpg' } }))
    .mockResolvedValueOnce(new Response('image', { headers: { 'content-type': 'image/jpeg' } }));
  const response = await fetchSocialImage('https://network-media.sproutsocial.com/public_media/?i=example', send);
  expect(await response.text()).toBe('image');
  expect(send).toHaveBeenCalledTimes(2);
});
it('rejects private or unrelated redirect destinations before fetching them', async () => {
  for (const location of ['https://127.0.0.1/image', 'http://169.254.169.254/', 'https://evil.test/image', 'https://cdninstagram.com.evil.test/image']) {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(fetchSocialImage('https://network-media.sproutsocial.com/public_media/?i=example', send)).rejects.toThrow('Unsupported social media host');
    expect(send).toHaveBeenCalledTimes(1);
  }
});
it('bounds a redirect loop', async () => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: '/loop' } }));
  await expect(fetchSocialImage('https://network-media.sproutsocial.com/loop', send)).rejects.toThrow('Too many media redirects');
  expect(send).toHaveBeenCalledTimes(4);
});
