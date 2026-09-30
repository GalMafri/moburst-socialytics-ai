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
