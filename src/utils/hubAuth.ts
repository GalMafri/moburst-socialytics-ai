// Hub Dashboard JWT token utilities

// The Hub passes ?hubToken=<jwt> when loading this tool in an iframe

const HUB_TOKEN_KEY = 'hub_token';

export const initHubToken = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('hubToken');
  
  if (fromUrl) {
    sessionStorage.setItem(HUB_TOKEN_KEY, fromUrl);
    
    // Clean the token from the URL without triggering a reload
    const url = new URL(window.location.href);
    url.searchParams.delete('hubToken');
    window.history.replaceState({}, '', url.toString());
    
    return fromUrl;
  }
  
  return sessionStorage.getItem(HUB_TOKEN_KEY);
};

export const getHubToken = (): string | null => sessionStorage.getItem(HUB_TOKEN_KEY);

export const clearHubToken = (): void => sessionStorage.removeItem(HUB_TOKEN_KEY);