// supabase/functions/_shared/google/api.ts
//
// Google's REST APIs as the decks use them: JSON in and out, a bearer access
// token, quiet retries on a rate limit or a server error, and errors that
// never carry the token.

import { redact } from "./oauth.ts";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export interface GoogleApi {
  json<T = unknown>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  /** The raw response, for an upload session. */
  raw(method: string, url: string, init: { body?: BodyInit; headers?: Record<string, string> }): Promise<Response>;
}

export function googleApi(accessToken: string, f: Fetch = fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): GoogleApi {
  const call = async (method: string, url: string, init: { body?: BodyInit; headers?: Record<string, string> }): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, { method, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) }, ...(init.body !== undefined ? { body: init.body } : {}) });
      if (res.ok || !(res.status === 429 || res.status >= 500) || attempt >= 3) return res;
      await sleep(1000 * 2 ** attempt);
    }
  };
  const fail = async (res: Response, method: string, url: string) => {
    const text = await res.text().catch(() => "");
    return new GoogleApiError(`Google ${method} ${new URL(url).pathname} answered ${res.status}: ${redact(text, [accessToken]).slice(0, 300)}`, res.status);
  };
  return {
    async json(method, url, body, headers) {
      const res = await call(method, url, { headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(headers ?? {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (!res.ok) throw await fail(res, method, url);
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as never;
    },
    async raw(method, url, init) {
      const res = await call(method, url, init);
      if (!res.ok) throw await fail(res, method, url);
      return res;
    },
  };
}
