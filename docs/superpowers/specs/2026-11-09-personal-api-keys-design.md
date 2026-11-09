# Personal API keys for Moburst people

Status: design for Lital's review, 9 Nov 2026. Nothing is built.

## Why

Lital, 9 Nov: "the api should also provide users with access to socialytics as a moburst user, for example Gal from our Core team wants to use it for his own tasks". How Gal will use it isn't known yet, so this covers both ways a person works.

Today there are two doors, and neither is a person's own key:

- **The Claude connector** works for a person as themselves: it reads what their Socialytics account can see, and staff can save notes, approved copy, strategy sections and decks. It needs nothing new; a person clicks Connect on Socialytics in Claude.
- **API keys** are made by an admin for a tool (Fernando's gOS key is one). A key reaches the companies or clients the admin chose, or everything; it doesn't belong to a person, doesn't follow anyone's access, and its calls aren't recorded as anyone.

What's missing is a key that belongs to a person, for their own scripts and tools.

## What it does

1. **Anyone at Moburst with a Socialytics account makes their own key**, on a "Your API keys" card they can open from the account menu (Settings stays admin-only). They name it, copy it once, and can revoke it. Admins also see every personal key, whose it is, when it was last used, and can revoke it.
2. **A personal key reaches exactly what its owner can see in Socialytics, live.** Its reach is worked out on every call from the owner's own access, by the same rule the app uses (`can_access_client`): an admin reaches every client, a Moburst user limited to some companies reaches those, and a change to the person's access applies to their key at once. A person who loses access, or whose account is removed, has a key that no longer works.
3. **Read only, to start.** A personal key has the `read` scope: every GET route of the API, as documented. No demo jobs and no key management. Saving through a personal key (notes, copy, strategy sections, the saves the connector already has) is added when someone needs it, as its own change.
4. **Recorded as the person.** Every call with a personal key writes the owner's id with the request (`api_requests.user_id`), so usage reads per person.
5. **Expiry.** A personal key lasts 90 days; the card shows when it expires, and a new key is one click.
6. **Same API, same docs.** Personal keys use the existing routes, envelopes, rate limit (120 a minute) and OpenAPI document. The integration guide gets a short "Your own key" section and a section 12 entry; nothing changes for Fernando's key.

## How it fits the code

- The API core (`_shared/api/`) is copied verbatim from AdVisor under one checksum, so it doesn't change. The key lookup Socialytics plugs into it (`api/index.ts` `touchKey`, the `api_key_touch` database function) does the work: for a personal key it returns the owner's reachable clients as the key's `client_ids`, worked out from the owner's access at that moment.
- **Careful case:** the core reads a key with no `client_ids` and no `company_slugs` as "every client". A personal key whose owner can see no client must never fall into that: it answers as having no reach (an empty list of real ids is not enough; it gets a value no client has, or the call is refused).
- `api_keys` gains `owner_user_id` (null for tool keys). A personal key is made by a database function the person calls as themselves (never through an OAuth token from the connector, like every other write); only the key's hash is stored, as for tool keys.

## Decisions for Lital

1. **Who can make a key?** My default: Moburst staff in Socialytics (admin and Moburst user roles). A person whose Socialytics role is "client" can't, even with a moburst.com address. Example: liran.gal@moburst.com has the client role (from his gOS company assignments) and would need his role changed first; gal.m@moburst.com is an admin and could. Right?
2. **Read only for now**, with saving added on request. Right?

## Not in this change

- AdVisor gets the same only if asked (its core would need the same lookup change on its side).
- Saving through personal keys.
