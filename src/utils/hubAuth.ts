// Hub Dashboard JWT token utilities

// The Hub passes ?hubToken=<jwt> when loading this tool in an iframe

const HUB_TOKEN_KEY = 'hub_token';

// QA 22 Nov 2026: with site data blocked, sessionStorage throws, which left sign-in on "Signing you in" for
// good. The token is then kept for this page only.
let tokenInMemory: string | null = null;
const read = (): string | null => { try { return sessionStorage.getItem(HUB_TOKEN_KEY); } catch { return tokenInMemory; } };
const write = (token: string): void => { tokenInMemory = token; try { sessionStorage.setItem(HUB_TOKEN_KEY, token); } catch { /* kept in memory */ } };
const remove = (): void => { tokenInMemory = null; try { sessionStorage.removeItem(HUB_TOKEN_KEY); } catch { /* nothing stored */ } };

export const initHubToken = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('hubToken');
  
  if (fromUrl) {
    write(fromUrl);
    
    // Clean the token from the URL without triggering a reload
    const url = new URL(window.location.href);
    url.searchParams.delete('hubToken');
    window.history.replaceState({}, '', url.toString());
    
    return fromUrl;
  }
  
  return read();
};

export const getHubToken = (): string | null => read();

export const clearHubToken = (): void => remove();