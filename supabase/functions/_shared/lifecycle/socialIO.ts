// supabase/functions/_shared/lifecycle/socialIO.ts
//
// The social_read step's network (socialRead.ts SocialIO), as the server
// runs it: Sprout's posts, follower locations and profile list, the profile
// pictures, the Instagram bio through the app's Apify client, and the brand
// read through OpenAI. The tests stand in for all of it.

import { listOwnedPostRows, MAX_POST_PAGES } from "../sprout/posts.ts";
import { listFollowerLocations } from "../sprout/audience.ts";
import { listCustomerProfiles } from "../sprout/profiles.ts";
import { apifyClient, APIFY_TOKEN_ENV } from "../apify/client.ts";
import { readInstagramBio } from "../apify/instagramProfile.ts";
import { readLinkedInPage } from "../apify/linkedinPage.ts";
import { openaiKeyFor, readSocialBrand } from "../brand/research.ts";
import { isPubliclyFetchable } from "../net/safeUrl.ts";
import type { SocialIO } from "./socialRead.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

/** A picture's bytes, read directly with a time limit and a size limit, from a public address only. */
async function image(url: string): Promise<Uint8Array | null> {
  if (!isPubliclyFetchable(url)) return null;
  try {
    const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return bytes.byteLength && bytes.byteLength <= MAX_IMAGE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export function liveSocialIO(): SocialIO {
  return {
    now: () => new Date(),
    posts: (ids, since, until, customer) => listOwnedPostRows(ids, { since, until, customerId: customer, pages: MAX_POST_PAGES }),
    followers: (ids, since, until, customer) => listFollowerLocations(ids, { since, until, customerId: customer }),
    customerProfiles: (customer) => listCustomerProfiles(customer),
    image,
    instagram: (handle, runId) => readInstagramBio(apifyClient({ token: env(APIFY_TOKEN_ENV) }), handle, { runId, waitSecs: 60 }),
    linkedinPage: (url, runId) => readLinkedInPage(apifyClient({ token: env(APIFY_TOKEN_ENV) }), url, { runId, waitSecs: 60 }),
    openaiKey: (db) => openaiKeyFor(db),
    brandRead: (input) => readSocialBrand(input),
  };
}
