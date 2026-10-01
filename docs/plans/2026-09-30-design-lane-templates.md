# Design lane: templates filled by code (approved 2026-09-30)

Goal: clients self-serve on-brand posts in Socialytics, every platform, stills and carousels first, video next.

Architecture (the pattern Canva Brand Kit, Figma Buzz and Adobe GenStudio share):

1. Design system as data, per client, built once from the client's harvested posts and approved once:
   tokens (typeface, weights, casing, ink, surface, accent, background, logo source + position + scale, frame, card),
   templates per format (locked regions for logo, headline, hero, optional sub), imagery rule (materials, lighting, never).
2. Deterministic server-side renderer: template + tokens + headline (+emphasis) + hero + platform spec -> PNG.
   SVG composed in code, rendered with resvg (WASM) in the edge runtime, brand fonts fetched once and cached in storage.
3. Per-post run (advance-creative-plan): planner picks template + headline + emphasis + hero subject under the imagery rule;
   hero generated with the client's references (wordless, calm region per template); wordless review; render; save done.
   Two or three options per post from template x hero.
4. Self-serve: setup panel to approve the design system; Design for client users with a spend guard; pick, edit headline, approve.
5. Video: motion templates on the same tokens (captions, logo, card, frame over a generated scene).

Sequence: renderer spike -> schema + builder + previews -> pipeline -> UI -> video.

## Built (2026-10-01)

- `client_design_systems` (draft -> approved -> retired; one approved per client) and the public `brand-assets` bucket
  (fonts/, logos/, previews/, runtime/). RLS: client members read, Moburst staff with client write access manage.
- `build-design-system` (staff session, or the project's server secret for schedules and operations):
  one Sonnet vision read of up to eight harvested posts -> tokens, 3-8 templates, imagery rule, up to three candidate
  logo boxes; the logo is cut from the candidate with the least stray ink (`bestLogoCut`), falling back to the client's
  logo file; a preview per template is rendered with a stand-in hero drawn from the tokens.
- `render-design`: exactly one still per request. The edge runtime allows about two seconds of CPU per request and a
  1080x1350 render costs 0.6-0.8 s (resvg) plus decode, so every render is its own request; the glass card uses a
  quarter-scale box-blurred copy of the hero (a few ms) instead of an SVG blur filter (0.8 s). The resvg binary is kept
  in `brand-assets/runtime/` after the first fetch, like the fonts.
- `advance-creative-plan`: when the client has an approved system, the first tick stores `design_system_id` and a
  `template_id` per frame on the plan (templates with a generated hero, matching the format, distinct within the run,
  avoiding the client's two most recent runs), asks for a hero shaped for that template (`designedHeroPrompt`), and
  on approval renders each frame through `render-design` and saves `post_iterations` with `finishing = 'done'`.
  Clients without an approved system keep the previous path (raw artwork finished in the browser).
- Client Setup: the Design system panel (tokens, logo, template previews, Build / Rebuild from posts, Approve).
- Templates whose hero is a client photo (`hero: photo`) or no hero are stored but not used by automatic runs yet;
  they are for the self-serve editor where the user supplies the photo.

## Version 2 (2026-10-01): templates read from the client's posts

The version-1 lane (tokens described by a vision model, layouts rendered from
percentages) produced slide-deck cards and was rejected. Version 2 keeps the
architecture and replaces the designer:

- `read-social-template`: one round per request. The model proposes the post as
  layers (background, images, panels, text with the post's exact words and
  pixel boxes, lines, frame); `layers.ts` renders them; `compare.ts` scores the
  render against the post (SSIM on greyscale) and draws a difference heatmap;
  the next round shows the model the post, the render and the heatmap and asks
  for corrections. Faces are never named by the model: `fontMatch.ts` lays the
  text block out in forty candidate Google families and compares ink.
- `build-social-templates`: one unit of work per call (the panel or a cron job
  drives it): read the next post, refine while the score is under 0.62 (three
  rounds at most), keep the best read as a template (`template.ts`: fixed
  layers, text slots by role, hero slot, lifted assets) or reject it under
  0.45, then match faces. The reproduction render is the template's preview,
  shown in Client Setup next to the post it came from. Approving the library
  makes it the client's system (version 2).
- Per post: `v2.ts` picks a template for the format, asks the image model for a
  hero shaped for the hero slot, reviews the artwork alone, and `fillTemplate`
  composes the slots with fitted copy and the hero shown through its slot.

Measured on Moburst, 2026-10-01: quote post 0.68, title card 0.64 (first
round), carousel slide 0.86; three templates kept in the first six minutes of
the library build (0.60, 0.83, 0.80).
