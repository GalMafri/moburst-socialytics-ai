# The logo tone replay: recorded run

Plan: `docs/superpowers/plans/2026-11-16-logo-tone.md`, task 8. Script: `server/scripts/tone-replay.ts`.

- Date: 16 Nov 2026. Run: on the tree of the commit that adds this file, `09edc6c7` (`npx tsx server/scripts/tone-replay.ts`, exit 0, 3 minutes 35 seconds). The tables below are this run's.
- Where: a laptop, Node 22, no model call, no network, nothing written outside a scratch folder.
- Manifest: written by a throwaway script from the diagnosis' client list (`picture-in-app/diag/scripts/clients.json`: 14 clients with their logo paths, placements, backgrounds and post paths), the files on disk beside it (each client's stored logo and its first posts, and the 17 stored designs of three clients), and the expected values of the spec's run (`logo-tone-r2/evidence.json`) and of the plan's two tables. Every file was read from its local copy. The manifest is not committed.
- Gaps, as in the spec: for clients with more than 8 reference posts only the first 8 were on disk (all 16 for one client, 7, 6, 6 and 4 for four others); the 17 jobs are named by the first 8 characters of their ids; one client's placement was written for its untrimmed logo.
- Result: 0 rows differ of 142 (14 sets, 111 posts, 17 designs). A logo was found on 31 of 111 posts. 11 of 17 designs pass and 6 fail.
- Slowest locate with templates: 6140 ms. Slowest read of one post: 6032 ms. Both on the laptop; the service's own speed is not measured here.

Compared exactly on every row: the files of the set, the canvas file, its ground and where the ground came from, each post's found or not and the file it shows, each design's pass or fail and the file that would be stamped. A score within 0.01 of the expected one counts as equal.

## The sets

| Client | Row | Own ground | Expected set and canvas | Got | Posts read, found, shown | Same |
|---|---|---|---|---|---|---|
| Adaptive Sound Technologies | lifecycle | light | stored, other (made); other on #0F294C, client_posts | stored, other (made); other on #0F294C, client_posts | 16, 5, other 5 | yes |
| Bader Law | person | dark | stored; stored on #0C1D2F, settings | stored; stored on #0C1D2F, settings | 8, 0 | yes |
| BetterBee | lifecycle | light | stored; stored on #FF9D2F, settings | stored; stored on #FF9D2F, settings | 7, 0 | yes |
| Buzznow | lifecycle | light | stored, other (made); stored on #F7E8E5, client_posts | stored, other (made); stored on #F7E8E5, client_posts | 8, 6, stored 4, other 2 | yes |
| DermaAngel US | lifecycle | dark | stored, white; stored on #0B0E1A, settings | stored, white; stored on #0B0E1A, settings | 8, 2, stored 1, white 1 | yes |
| European Wax Center | lifecycle | light | stored; stored on #FFFFFF, settings | stored; stored on #FFFFFF, settings | 8, 0 | yes |
| Kitcaster by Moburst | lifecycle | dark | stored; stored on #233A5E, settings | stored; stored on #233A5E, settings | 6, 0 | yes |
| Moburst | person | dark | stored; stored on #0B0E1A, settings | stored; stored on #0B0E1A, settings | 8, 4, stored 4 | yes |
| Olo | lifecycle | dark, shows on both | stored, white; white on #2A95FD, client_posts | stored, white; white on #2A95FD, client_posts | 8, 3, white 3 | yes |
| Pay The Pyper | lifecycle | light | stored, other (made); stored on #1A1A1A, settings | stored, other (made); stored on #1A1A1A, settings | 4, 4, stored 2, other 2 | yes |
| PrepSmart Recipes | lifecycle | dark | stored, other (made); other on #F2EADF, client_posts | stored, other (made); other on #F2EADF, client_posts | 8, 3, stored 1, other 2 | yes |
| Twos | lifecycle | light | stored; stored on #FFF9EA, settings | stored; stored on #FFF9EA, settings | 8, 0 | yes |
| Uproar by Moburst | lifecycle | dark | stored; stored on #192033, client_posts | stored; stored on #192033, client_posts | 6, 2, stored 2 | yes |
| Yangra | lifecycle | dark | stored; stored on #151A42, client_posts | stored; stored on #151A42, client_posts | 8, 2, stored 2 | yes |

## The designs

The first template is the set's canvas file over the set's canvas ground, as a job started from that set sends it. The placement is the one the design's own job had.

| Client | Job and design | Templates | Expected scores | Got scores | Expected | Got | Color distances | Time | Same |
|---|---|---|---|---|---|---|---|---|---|
| Adaptive Sound Technologies | 84a0cd83 design-1 | other on #0F294C; stored on #FFFFFF | 0.458 and 0.236 | 0.458 and 0.236 | fail | fail | other 284.4, stored 72.2 | 1367 ms | yes |
| Adaptive Sound Technologies | 84a0cd83 design-2 | other on #0F294C; stored on #FFFFFF | 0.492 and 0.243 | 0.492 and 0.243 | fail | fail | other 275.1, stored 57.9 | 1364 ms | yes |
| Adaptive Sound Technologies | 75844f22 design-3 | other on #0F294C; stored on #FFFFFF | 0.469 and 0.392 | 0.469 and 0.392 | fail | fail | other 284.6, stored 40.6 | 1346 ms | yes |
| Adaptive Sound Technologies | daa1be70 design-2 | other on #0F294C; stored on #FFFFFF | 0.455 and 0.236 | 0.455 and 0.236 | fail | fail | other 297.5, stored 58.5 | 1342 ms | yes |
| Adaptive Sound Technologies | 29b0d751 design-1 | other on #0F294C; stored on #FFFFFF | 0.314 and 0.919 | 0.314 and 0.919 | pass, stored | pass, stored | stored 81.9, other 351.5 | 6132 ms | yes |
| Adaptive Sound Technologies | 5853aaa3 design-1 | other on #0F294C; stored on #FFFFFF | 0.323 and 0.835 | 0.323 and 0.835 | pass, stored | pass, stored | stored 102.1, other 306.9 | 6135 ms | yes |
| Adaptive Sound Technologies | 3fef7ba7 design-1 | other on #0F294C; stored on #FFFFFF | 0.299 and 0.960 | 0.299 and 0.960 | pass, stored | pass, stored | stored 82.9, other 357.8 | 6126 ms | yes |
| Adaptive Sound Technologies | 93c83d46 design-2 | other on #0F294C; stored on #FFFFFF | 0.350 and 0.907 | 0.350 and 0.907 | pass, stored | pass, stored | stored 89.1, other 335.2 | 6116 ms | yes |
| Adaptive Sound Technologies | 0fcbcc71 design-1 | other on #0F294C; stored on #FFFFFF | 0.964 and 0.314 | 0.964 and 0.314 | pass, other | pass, other | other 37.2, stored 281.5 | 6134 ms | yes |
| Adaptive Sound Technologies | 6db03b9e design-1 | other on #0F294C; stored on #FFFFFF | 0.931 and 0.308 | 0.931 and 0.308 | pass, other | pass, other | other 66.3, stored 263.3 | 6113 ms | yes |
| Adaptive Sound Technologies | a5a3b7ec design-2 | other on #0F294C; stored on #FFFFFF | 0.924 and 0.307 | 0.924 and 0.307 | pass, other | pass, other | other 51.2, stored 272.6 | 6140 ms | yes |
| Adaptive Sound Technologies | b543eb1d design-2 | other on #0F294C; stored on #FFFFFF | 0.961 and 0.324 | 0.961 and 0.324 | pass, other | pass, other | other 30.3, stored 285.3 | 6140 ms | yes |
| Adaptive Sound Technologies | be7fccee design-1 | other on #0F294C; stored on #FFFFFF | 0.737 and 0.274 | 0.737 and 0.274 | fail | fail | other 245, stored 115.5 | 6135 ms | yes |
| BetterBee | f553e4b3 design-1 | stored on #FF9D2F | 0.373 and none | 0.373 and none | fail | fail | stored 192.2 | 586 ms | yes |
| BetterBee | f553e4b3 design-2 | stored on #FF9D2F | 0.827 and none | 0.827 and none | pass, stored | pass, stored | stored 59.3 | 612 ms | yes |
| Pay The Pyper | 53e1c25c design-1 | stored on #1A1A1A; other on #0B0E1A | 0.614 and 0.971 | 0.614 and 0.971 | pass, other | pass, other | other 28.3, stored 114.5 | 3243 ms | yes |
| Pay The Pyper | 20d0c025 design-1 | stored on #1A1A1A; other on #0B0E1A | 0.617 and 0.980 | 0.617 and 0.980 | pass, other | pass, other | other 26.8, stored 113.9 | 2372 ms | yes |

## The posts with a found logo

The other posts were expected not found and were not found.

| Client | Post | Score | Matched search | Shows | Expected | Ground, flatness | Same |
|---|---|---|---|---|---|---|---|
| Adaptive Sound Technologies | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-bb2628a6a3d0f67b2d4a50f1fa5d903bf591c29c840ac6598d4f9320c016ee35.jpg` | 0.954 | other | other | other | #3B3849, 0.511 | yes |
| Adaptive Sound Technologies | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-f6f38cb95a28d91e34ce23a1b9fe80942803a3ef2ad4900091a18ff74a0c6c26.jpg` | 0.895 | other | other | other | #3B3946, 0.517 | yes |
| Adaptive Sound Technologies | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-f2f3aef646cb52c47bb9ee050f3c44ac2cfa95bedafed54456d54b0609ca26d3.jpg` | 0.969 | other | other | other | #0C2A50, 1 | yes |
| Adaptive Sound Technologies | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-5be8770a092138c3f1ed5e054253e195f9c6b15793bc417edb74fdeade3d12d2.jpg` | 0.969 | other | other | other | #0F294C, 1 | yes |
| Adaptive Sound Technologies | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-90941294b5ce2ca7acbf830eb7efd95415489066466eb4dfb6952b7b0dc410cf.jpg` | 0.938 | other | other | other | #0F294C, 0.998 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-f11db90ffa589afa68c962acf8bb36fe35662dcacce9c238fe9274c31fe36595.jpg` | 0.897 | other | other | other | #838486, 0.463 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-6888a0657e1c508975ddcd1c885b176e294e6cd839cbfacb68a821fb05df9aff.jpg` | 0.983 | stored | stored | stored | #F7E8E5, 0.998 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-9a2abe67cb26f4ce0724737caaf3a2ec4741f44577fd46c185ac7e88ed000464.jpg` | 0.958 | other | other | other | #4D2B08, 0.219 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-2f485669c28ca88a0a9e852dc21670a868df3ea51d6363a4205a617d6c9f2a9e.jpg` | 0.956 | stored | stored | stored | #F7E8E5, 0.999 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-bb764a6c93e1b952f6bd71c135d58d40da46b33aaae1342a0557017b428ab9dd.jpg` | 0.984 | stored | stored | stored | #FBF4EA, 0.999 | yes |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-e9b88a48ed373d565b88017b967cdd100a6fd5d6fdabde0a1e4abfbda6659a5a.jpg` | 0.957 | stored | stored | stored | #F7E8E5, 1 | yes |
| DermaAngel US | `ed267046-def3-4a2b-8e04-c4d1075602c8/social-86bcc4b142d0649513eaa62fa48ca2eec7d96209e98ff3ac98ebc93ca712484c.jpg` | 0.907 | stored | white | white | #01BEDC, 0.769 | yes |
| DermaAngel US | `ed267046-def3-4a2b-8e04-c4d1075602c8/social-8df20e5ecc1cf85533e5d613e92fee889a39fe94b6fc0f6f7a8ea3ac3c48b81f.jpg` | 0.944 | other | stored | stored | #D5EEF5, 0.996 | yes |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453062895-oosy.jpg` | 0.966 | stored | stored | stored | #104469, 0.395 | yes |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453063810-b68a.jpg` | 0.989 | stored | stored | stored | #185581, 0.807 | yes |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453065522-q65a.jpg` | 0.971 | stored | stored | stored | #1E394C, 0.556 | yes |
| Moburst | `d00ce604-2bcc-455a-9826-f80250db75cf/social-ea5a96f6dd117bf720ed3193a4e295347cfa2da73d51153228a5f39867215aff.jpg` | 0.969 | stored | stored | stored | #090911, 0.997 | yes |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-c7b9a27232f17d7ead7cbe42c9149aa24791a7bf353ad6f1fb0db4ce11d9f3de.jpg` | 0.969 | stored | white | white | #C7AB86, 0.826 | yes |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-c56fe2915498ae41ef6e12dcf1ef3c054bf83a94e6f0d0ef3e17833bf5f62d8b.jpg` | 0.948 | stored | white | white | #563723, 0.022 | yes |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-eacaeab2132ae761cf44ba532d413d09e3fa0f967e03ed0a6a8d869a1da21223.jpg` | 0.978 | stored | white | white | #2A95FD, 0.995 | yes |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-7e41476edb23c66760d0d456fa115466ccf84ac616e5ca761404c312dfc8bfdf.jpg` | 0.988 | stored | stored | stored | #E8E8E8, 0.991 | yes |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-f5113c68a595ef3bb043bd35af80fa09a19a45ce9601a5c5e2842e07528325f0.jpg` | 0.979 | stored | stored | stored | #E8E8E8, 0.993 | yes |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-d4812fea5bfb594d35a0c70653aa53d09c154f43ffe10ada34daca27ea4e79eb.jpg` | 0.987 | other | other | other | #1A1A1A, 0.995 | yes |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-ed50bb879d4f4450d64c0d3e6c2cfdbee72b2d5ebf96aa2d2250551f82e4dd36.jpg` | 0.984 | other | other | other | #1A1A1A, 0.994 | yes |
| PrepSmart Recipes | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-051723f29c806b29f3f77a4bc9640735569952107d166f5b531726f9729e9658.jpg` | 0.773 | other | other | other | #FCF3E4, 0.995 | yes |
| PrepSmart Recipes | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-15c31558800cf55987667de284fd21fadf9522dc47d9825ae6719803e4624e7f.jpg` | 0.761 | stored | stored | stored | #1E1B16, 1 | yes |
| PrepSmart Recipes | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-6221ab134380280c0fed658e59ded855ca57bfd293cfc6f086a2e0af1a545d05.jpg` | 0.756 | other | other | other | #F2EADF, 1 | yes |
| Uproar by Moburst | `a471e187-5e48-4aaa-bbb6-d571056f3795/social-2d30612ac0746c1a44a3f42a49ee4b5b0f730b3c4c19033eb3bfc5039542afa9.jpg` | 0.966 | stored | stored | stored | #192033, 0.993 | yes |
| Uproar by Moburst | `a471e187-5e48-4aaa-bbb6-d571056f3795/social-59f3ba3c7bcbe50fba446b550cbd361531c2cc7156cb2ed8661d5b8976e473d5.jpg` | 0.907 | stored | stored | stored | #1A4565, 0.867 | yes |
| Yangra | `925faba1-4d0a-4e4d-b300-41c6fe28b73f/social-cbe5950559b1db8320e55223bd57fd6f02fa0907e2b4f95040932822faf96468.jpg` | 0.973 | stored | stored | stored | #0342AB, 0.994 | yes |
| Yangra | `925faba1-4d0a-4e4d-b300-41c6fe28b73f/social-cb1b07102b573402cfb6911f8de734b40717f75704bffcb9861d03815b94425f.jpg` | 0.969 | stored | stored | stored | #151A42, 0.998 | yes |

Posts not found: 80, of which 0 could not be read. 2 of them score at or above the bar of 0.75 (0.903, 0.887) and are not found because the best match sits at an end of the sizes searched, which is the second half of the one test. The highest score among the rest is 0.662.

## The run at the end of the build

Run again at `b30d89c3`, with every task built (the worker's side, the job's input, the lifecycle step, rows a person set, the card): exit 0, 0 rows differ of 142, and every result is the same as in the tables above, score for score and distance for distance. The two commits after it change only the generated database types, the Deno lock file and this record. The times of that second run are not comparable (slowest locate 17,310 ms): the whole test suite, both builds and the rehearsal of main's build job ran on the same laptop at the same time.

## The made files, looked at at full size

Every file the making rule gives for the 14 stored logos was written from the product's own `logoSet`, laid on the ground it serves, and looked at at full size, with the edges and the places where two colors meet enlarged 3 to 8 times. They are the same bytes as the files of the spec's run. 22 files: 13 copies for the other ground and 9 white copies.

Used with the posts on disk (6 files), all clean, with every edge as smooth as the stored file's:

| Client | File | What it is |
|---|---|---|
| Adaptive Sound Technologies | copy for dark pictures | the wordmark in white |
| Buzznow | copy for dark pictures | the mark and wordmark in white |
| DermaAngel US | white copy | the wordmark in white |
| Olo | white copy | the mark in white, on the canvas over the client's own blue |
| Pay The Pyper | copy for dark pictures | the green kept, the black letter in white; the letter does not touch the green |
| PrepSmart Recipes | copy for light pictures | the wordmark in #0B0E1A, the orange hat and spoon kept; they do not touch the wordmark |

Not used (16 files): no post of the client shows the logo closer to that file than to another, so the set does not hold it, no canvas carries it and no design is stamped with it. What each looks like, said plainly:

| Client | File | Seen |
|---|---|---|
| BetterBee | copy for dark pictures | As first built, a line about one pixel wide of the old orange and purple blend stayed along the orange where it meets the part that turned white. Fixed in the rule after review (below): the edge is clean now. The white copy is one flat silhouette of the mark. |
| Kitcaster by Moburst | both copies | Letter edges are hard and slightly heavy: the stored file has no soft alpha at its edges (its edge pixels are opaque blends with a dark backdrop), and each takes the flat ink. The copy for light pictures loses all four brand colors. |
| Yangra | copy for light pictures | The specks of missing ink in three letters of the stored file are in the copy too, and the file is small (285 pixels wide), so its edges are coarse. |
| Moburst, Uproar by Moburst | copy for light pictures | Every brand color of the mark becomes #0B0E1A. The white copies are clean one-color files. |
| Bader Law | both copies | Clean: the red mark kept and the wordmark in #0B0E1A; all white. |
| DermaAngel US | copy for light pictures | Clean, and near black, which the brand's posts do not show (they show teal). |
| European Wax Center, Twos | copy for dark pictures | Clean, in white. |
| Pay The Pyper, PrepSmart Recipes | white copy | Clean, in white. |

Two defects a client's posts could one day put in use were named here when the build ended. Where each stands after the review of the build:

- The line of old blend where a kept color touches a turned one (one file of the 14). Fixed in the rule: a blended pixel between two whole parts with different outcomes gets the same mix of their new colors as it had of their old ones (step 4 of the making rule, Ruling 42 of the plan). All 22 files were made again from the 14 stored logos with the product's own `logoSet` and compared byte for byte with the files above: 21 are the same, the six in use among them, and BetterBee's copy for dark pictures changed in 254 pixels along the orange shape. Looked at again at full size and enlarged six times at that edge: orange meets white with a smooth edge and no line.
- Hard edges in a copy of a stored file that has none of its own. Measured on the 14 stored files: the share of edge pixels with soft alpha is 1% for Kitcaster and 3% for Yangra, and 77% to 99% for the other twelve. Not fixed: the cause is the backdrop cut where the stored file is made, which this change leaves alone, and the pictures those two files were cut from were not available to prove a fix on (Ruling 43). The spec's decision 1 shows the owner Kitcaster's white copy beside its stored file and says that a copy not in use turns on by itself when a post shows it.

## The run after the review of the build

Run again at `4a163bdf`, with the review's fixes built (the covered ground of a logo that shows on both grounds, the blend rule, the preference for a template that passes the one test, posts gone from storage left out): `npx tsx server/scripts/tone-replay.ts`, exit 0, 0 rows differ of 142 (14 sets, 111 posts, 17 designs). A logo was found on 31 of 111 posts, and 11 of 17 designs pass and 6 fail. Slowest locate with templates 6,152 ms, slowest read of one post 6,010 ms, on the laptop with nothing else running.

Against the run at the end of the build, row by row and apart from times: 141 rows are the same in every recorded value, score for score and distance for distance. One row has another score and the same result: a BetterBee post with no found logo scores 0.018 where it scored 0.037, because the second search uses BetterBee's copy for dark pictures and that file changed.

No client's templates changed. The one client whose stored logo shows on both grounds carries its white copy on the canvas, which the new rule for the covered ground does not touch. A reviewer's other proposal, the covered ground read from the canvas color for every stored file, was measured on the two stored designs of the client it would change (a scratch run with the service's own `locateTemplates`): the stored file over #FFFFFF as the second template scores 0.369 and 0.332 where the copy over #0B0E1A scores 0.971 and 0.980, so both designs would go from pass to fail. It was not built.

## The run of 17 Nov 2026 (the logo on the ground it was made for)

Spec section 11 and its second pass. Run: `npx tsx server/scripts/tone-replay.ts` on the tree of the commit that adds this section, exit 0, 4 minutes 49 seconds on a laptop that was running other work. No model call, no network, nothing written outside a scratch folder. Manifest: the 14 entries of the 16 Nov run with their recorded files, the brand colors of each lifecycle row (read from the live rows, read only), and one new entry for the client of 16 Nov (its 18 designs that failed, the 2 designs of the job that ended ready and the picture delivered, from the stored files).

Result: 0 rows differ of 181 (15 sets, 13 settings backgrounds, 115 posts, 38 designs). A logo was found on 35 of 115 posts. 30 of 38 designs pass.

The earlier 142 rows against the run of 16 Nov, row by row: 140 keep their result (found or not and the file a post shows, pass or fail and the file stamped, the files of a set, its canvas file and ground). Two sets have another canvas, and both were wrong:

| Client | Canvas on 16 Nov | Canvas now | Why the 16 Nov row was wrong |
|---|---|---|---|
| The client of 16 Nov | stored file on #1A1A1A | stored file on #E8E8E8, from its light posts | The near-black letter has 1.01:1 on #1A1A1A: two letters of three on every canvas. |
| The orange and purple mark | stored file on #FF9D2F | stored file on #FFFFFF | The orange half of the mark (37.1% of its ink) has 1.08:1 on #FF9D2F. |

Their stored designs keep pass or fail and the file stamped. The first template is laid over the new ground, so its score moved: the first client's two designs 0.614 and 0.617 to 0.362 and 0.331 (the second template, 0.971 and 0.980, is what passes them, as before); the second client's design-1 0.373 to 0.426 (fail) and design-2 0.827 to 0.761 (pass, 0.011 over the bar: it was scored before against a template with the orange half missing).

The settings background, as the lifecycle writes it now (held to the file's weakest whole part): 10 of the 13 rows (the 12 lifecycle clients and the second entry of the client of 16 Nov) keep their background; the three that change are two entries of the client of 16 Nov and the orange and purple mark. The client of 16 Nov goes from #1A1A1A (weakest part 1.01:1) to #FFFFFF (2.91:1). The orange and purple mark goes from #FF9D2F (1.08:1) to #FFFFFF (2.23:1, the best either neutral gives it: its wordmark is black and the mark is orange and purple).

The 21 designs of the client of 16 Nov, each with its expected result written before the run:

| Designs | Expected | Got |
|---|---|---|
| 18 designs of 6 options (all failed on 16 Nov: 0.39 to 0.48) | found, the stored file stamped | 18 of 18 found with the stored file over #E8E8E8, 0.833 to 0.979; the second template (the copy over #0B0E1A) 0.297 to 0.474 |
| cf6cbd60 design-1 (the near-black letter drawn white on a dark band) | found, the copy with the white letter stamped | found, copy, 0.397 and 0.962 |
| cf6cbd60 design-2 (delivered with two letters of three on a dark band) | not found | not found, 0.407 and 0.471 |
| cf6cbd60 delivered picture | not found | not found, 0.344 and 0.451 |

The score of the second template of the delivered picture had no expected value of its own when the manifest was written (a placeholder of 0 was replaced by the measured 0.451 before this run; the expectation that mattered, not found, was written first).

Slowest locate 7.3 s, slowest read of one post 7.4 s, on a loaded laptop. The service's own speed is not measured here.

The sets and canvases were looked at at full size, cropped 1:1 around the logo, for all 15 manifest entries and the copy with the white letter on #0B0E1A. Every whole part of each file shows on its canvas ground. The live rows of 17 Nov for Olo and DermaAngel hold another canvas file and ground than this manifest, which uses the files of 16 Nov: those two are not re-measured here.

Correction (the review of 17 Nov): the reason given in the last sentence is wrong. The logo files did not change; the live steps read 12 to 16 posts where this manifest has 8, and a third client (PrepSmart Recipes) differs for the same reason. The run below is made on what the live step reads.

## The run of 17 Nov 2026, second review (on what the live step reads)

Plan rulings 64 to 72. Run: `npx tsx server/scripts/tone-replay.ts` on the tree of commit `547311fe` (code) with the manifest below, on a laptop running other work. No model call; the only network reads are GETs of the product's public storage (each live set's stored copies); nothing written outside a scratch folder.

Manifest: the 15 entries of the run above, unchanged, and one entry for each of the 14 live rows that hold a set, built from the row read on 17 Nov through the connector (read only): its own logo file, every post its step reads (`reference_paths`, 12 to 16), its brand colors, its live set (rule 1 or 2) and background. For each, the expected settings background, set and canvas were written from the rule before the run, and the expected window (what a design starts from on the live row before the lifecycle's next look) from the live row and the rule. Ten pictures were drawn for the review's cases (no model): a client's real file, or its white copy, laid on a flat color with noise and a slight shade, 1.04 times its usual width and shifted, at 2160 by 2700. The 21 designs of 16 Nov are also run through the window's templates.

First run: 2 rows of 407 differed, both expectations, both explained below; they were corrected and the run made again.

- The orange and purple client's stored design-2 (job f553e4b3), expected to pass as before, is made again: the orange half of its mark sits on the picture's coral (#FC805B) at 1.12:1. This is the line of Ruling 64, and the row of 16 Nov ("pass, 0.761") is wrong by it. At full size the half is told apart from the coral by its hue alone.
- The window score of the delivered picture of 16 Nov had an estimate (0.348) for its first template; the measured score is 0.335. It is not found either way.

Second run: 0 rows differ of 407 (29 sets, 25 settings backgrounds, 270 posts, 14 windows, 69 designs; exit 0, 9 minutes 5 seconds). A logo was found on 81 of 270 posts. 50 of 69 designs pass; 7 are made again because a whole part of every file that may be stamped does not show on the picture's ground (6 drawn, 1 stored). Slowest locate 7.2 s, slowest read of one post 7.1 s, on the laptop.

Each live row, before and after. "Live" is the set the row holds on 17 Nov; "by this rule" is what the lifecycle settles at its next look; "window" is what a design starts from until then. Every value below is a row of the run, compared exactly.

| Client | Row, rule | Background | Live canvas | Canvas by this rule | Window (canvas; second template) |
|---|---|---|---|---|---|
| Adaptive Sound Technologies | lifecycle, 1 | #FFFFFF, unchanged | other on #0F294C, posts | the same | other on #0F294C; stored on #FFFFFF |
| Bader Law | person, 1 | #0C1D2F, never written | stored on #0C1D2F | the same | the same; none |
| BetterBee | lifecycle, 1 | #FFFFFF (written by the runner of rule 2 on 17 Nov from #FF9D2F) | stored on #FF9D2F, settings | stored on #FFFFFF, its own neutral | stored on #FFFFFF; none |
| Buzznow | lifecycle, 2 | #FFCFDA, unchanged | stored on #F7E8E5, posts | the same | the same; other on #0B0E1A |
| DermaAngel US | lifecycle, 2 | #0B0E1A, unchanged | white on #00BFD9, posts | the same | the same; none |
| European Wax Center | lifecycle, 1 | #FFFFFF, unchanged | stored on #FFFFFF | the same | the same; none |
| Kitcaster by Moburst | lifecycle, 1 | #233A5E, unchanged | stored on #233A5E | the same | the same; none |
| Moburst | person, 1 | #0B0E1A, never written | stored on #0B0E1A | the same | the same; none |
| Olo | lifecycle, 2 | #0B0E1A, unchanged | white on #3F3E39, posts | the same | the same; stored on #FFFFFF |
| Pay The Pyper | lifecycle, 2 | #FFFFFF (from #1A1A1A, by the runner of rule 2) | stored on #E8E8E8, posts | the same | the same; other on #0B0E1A |
| PrepSmart Recipes | lifecycle, 2 | #0B0E1A, unchanged | stored on #1E1B16, posts | the same | the same; other on #FFFFFF |
| Twos | lifecycle, 1 | #FFF9EA, unchanged | stored on #FFF9EA | the same | the same; none |
| Uproar by Moburst | lifecycle, 1 | #0B0E1A, unchanged | stored on #192033, posts | the same | the same; none |
| Yangra | lifecycle, 1 | #181F36, unchanged | stored on #151A42, posts | the same | the same; none |

LegaBot (a person's row of an archived client) has no set and no step row, and is not in the manifest.

So the new line changes no stored set and no background. Three canvases differ from the manifest of 16 Nov, all already live and all by rule 2 as built before this review: DermaAngel US (white on #0B0E1A to white on #00BFD9: two of its 12 posts show its logo in white on its cyan, 2.22 and 2.23:1, as on its packaging; looked at at full size), Olo (white on #2A95FD to white on #3F3E39: 8 posts of 12 show the white file, the ground closest to the others is now a dark one) and PrepSmart Recipes (other on #F2EADF to stored on #1E1B16: with 12 posts the stored file's own posts give its ground). The design that starts on BetterBee's rule 1 set already starts on #FFFFFF, because a canvas from the settings reads the row's background as it is (Ruling 31).

The pictures drawn for the review's cases, each expected before the run:

| Client | Drawn | Expected | Got | Picture's ground, weakest part there |
|---|---|---|---|---|
| BetterBee | the stored file on #FF9D2F | made again, lost | lost, 0.940 | #F99729, 1.01:1 |
| Uproar by Moburst | the stored file on #FF6671 | made again, lost | lost, 0.925 | #FA616C, 1.06:1 |
| Uproar by Moburst | the white copy on #3BD4FF (the stored file has a cyan panel) | made again, lost | lost, 0.954 | #36CFFA, 1.05:1 |
| European Wax Center | the stored file on #231F20 | made again, lost | lost, 0.949 | #1D191A, 1.21:1 |
| European Wax Center | the stored file on #1A1A1A | made again, lost | lost, 0.934 | #141414, 1.14:1 |
| Twos | the stored file on #1A1A1A | made again, lost | lost, 0.973 | #1F1F1F, 1.27:1 |
| Buzznow | the stored file on #1A1A1A | made again: no template lies on such a ground | not found, 0.207 and 0.105 | #141414 |
| Pay The Pyper | the stored file on #1A1A1A | made again, the same | not found, 0.202 and 0.461 | #212121 |
| DermaAngel US | the white copy on #00BFD9 | found, white | found, white, 0.978 | #00B9D3, 2.36:1 |
| Olo | the white copy on #2A95FD | found, white | found, white, 0.999 | #248FF7, 3.31:1 |

The designs of 16 Nov (the client of 16 Nov), through the set of rule 2 and through the window on its live row: 18 of 18 on light pictures are found with the stored file (0.833 to 0.980), the green at 2.20:1 or more on the picture's ground; cf6cbd60 design-1 is found with the copy (0.962); design-2, delivered with two letters of three, and the delivered picture are not found (0.407 and 0.471; 0.344 and 0.451; through the window 0.411 and 0.471; 0.335 and 0.451).

The 181 rows of the 15 earlier entries keep their result except the orange and purple client's design-2 above. Of every post ground and design ground measured, none has its weakest part between 1.3 and 1.8:1, so any line in that band gives this run.

## The website second-file proof, first run

Tool: `supabase/tests/tools/site-logos.ts`, run under Deno on 16 Nov 2026. It fetched each homepage directly, listed the page's logo and its other logo files with the product's own `logoOnPage` and `logoFilesOnPage`, converted each with the product's own `logoPng` into a store kept in memory, and ran `sameLogo` against the client's stored logo. No model, no scraping service, nothing written to the product.

What it could and could not use. The clients' stored website addresses could not be read in that session (the database read was refused), so one homepage per client was tried by brand name. A page counts as the client's only when its own logo is the client's stored logo (shapes within 5%, overlap of 0.9 or more), which holds for 6 of the 14. The other 8 are listed and prove nothing about those clients.

| Client | Page | The page's own logo against the stored one | Other logo files listed | Passed |
|---|---|---|---|---|
| Bader Law | baderlaw.com | the stored logo (shape 0.999, overlap 0.997) | 2 | 0 |
| BetterBee | betterbee.ai | the stored logo (1.000, 1.000) | 0 | 0 |
| Buzznow | buzznow.com | the stored logo (1.000, 1.000) | 1 | 0 |
| European Wax Center | waxcenter.com | the stored logo (1.000, 1.000) | 2 | 0 |
| Olo | olo.com | the stored logo (1.000, 1.000) | 0 | 0 |
| Uproar by Moburst | uproarpr.com | the stored logo (1.000, 1.000) | 0 | 0 |
| Adaptive Sound Technologies | soundofsleep.com | another logo (shape 0.488) | 0 | 0 |
| DermaAngel US | dermaangel.com | the page gave no logo to a direct fetch | 0 | 0 |
| Kitcaster by Moburst | kitcaster.com | another lockup (shape 0.852, overlap 0.368) | 1 | 0 |
| Moburst | moburst.com | a WebP file, which the design path does not take | 3, all WebP | 0 |
| Pay The Pyper | paythepyper.com | an icon (shape 0.372) | 1 | 0 |
| PrepSmart Recipes | prepsmart.com | an icon (shape 0.344) | 0 | 0 |
| Twos | twosapp.com | an icon (shape 0.975, overlap 0.541) | 1 | 0 |
| Yangra | yangra.com | the page gave no logo to a direct fetch | 0 | 0 |

The five files on the six confirmed pages, each looked at at full size beside the stored logo:

| Client | File | Measured | Result | Seen |
|---|---|---|---|---|
| Bader Law | 261 by 44, own ground light | shape 1.000, overlap 0.980 | refused: narrower than the stored file (1,068 wide), test 4 | The brand's own logo for light pictures: the same lockup, the wordmark dark, the red mark kept. Tests 1 to 3 hold. |
| Bader Law | 142 by 24, own ground dark | shape 0.997, overlap 0.884 | refused: same ground, overlap under 0.9 | The stored logo again, small. |
| Buzznow | 1,200 by 869, own ground light | shape 0.231, overlap 0.230 | refused | The glasses mark alone, another drawing. |
| European Wax Center | 1,200 by 306, own ground light | shape 0.971, overlap 0.503 | refused: same ground | The wordmark in black with its mark placed differently. |
| European Wax Center | 1,200 by 315, own ground light | shape 1.000, overlap 1.000 | refused: same ground | The stored file again. |

What this shows and what it does not. No file passed, so no wrong logo would have been taken from these pages. The test met one real second file of a brand and refused it only for its width, so the website path has still not given any client a second file, and a right pass has not been seen. One made copy was confirmed by the way: the brand's own file for light pictures keeps the red mark and turns the wordmark dark, which is what the making rule's copy does for that logo. The proof on every client's stored website address is step 5 of the release order.

## The logo the client's posts show: replay on the 14 clients (17 Nov 2026)

Spec: section 12 of `docs/superpowers/specs/2026-11-16-logo-tone-design.md`. Script: `server/scripts/tone-replay.ts`, with the candidate files written by `supabase/tests/tools/site-logos.ts`.

- Run: on the tree of commit `22974210` (`npx tsx server/scripts/tone-replay.ts`), exit 0, 0 rows differ of 169 (14 choices, 14 sets, 115 posts, 26 designs). A logo was found on 41 of 115 posts and 14 of 26 designs pass. Slowest locate with templates 7,298 ms, slowest read of one post 24,057 ms, on a laptop that was also running other work.
- Where: a laptop, Node 22 for the replay and Deno 2.9 for the site read. No model, no provider, no call to the live picture service (the service's own functions run in the script), nothing written to the product.
- Candidates: each client's stored website address, fetched directly (`site-logos.ts`, no scraping service). The files are the product's own `logoFilesOnPage` and `logoPng` output, kept in a scratch folder. Posts: the files on disk beside the earlier replays, with the counts in the table (12 for the first client, which is all of its posts). Designs: yesterday's 9 of the first client, and the 17 stored designs of the 16 Nov record.
- Expected values: the first client's posts and designs from the diagnosis of 16 Nov (`yesterday-diag/wordmark-result.json`, measured with the search alone, not with this rule): the wordmark found on 10 of 12 posts, and on 3 of the 9 designs. Its placement and canvas ground were worked out by hand from the same measurements (below). The other clients' rows are the 16 Nov record's. The choice for a client with no candidate that differs from its stored file is expected not to change.

### What each client gets

| Client | Row | Logo today | Posts | Candidates (direct read of the homepage) | Shown on posts: today's logo, candidates | Result |
|---|---|---|---|---|---|---|
| Twos | lifecycle | the round icon its site serves as a file (1170 by 1200) | 12 | 1: the wordmark, an inline SVG in the header's link to the home page | 0 of 12 (best 0.501); wordmark 10 of 12 (0.815 to 0.992) | **Changes to the wordmark.** Placement center, width 0.148, top 0.902; background #0071FA; canvas ground #5D4E4B from 6 posts |
| Yangra | lifecycle | a white stacked lockup (285 by 150) | 8 | 1: an inline SVG kept in a data address (the site's whole logo), listed since this build | 2 of 8; candidate 2 of 8 (0.766, 0.792) | Equal counts: keeps its logo (first rule; under the revised count the candidate has 0, next section) |
| European Wax Center | lifecycle | wordmark, black | 8 | 2: its black and its standard wordmark | 0 of 8; 0 and 0 (best 0.261) | The posts show none: keeps its logo |
| Buzznow | lifecycle | mark and wordmark | 8 | 1: the glasses mark alone | 6 of 8; 0 (best 0.354) | Keeps its logo |
| Adaptive Sound Technologies, BetterBee, Olo, PrepSmart Recipes, Uproar by Moburst | lifecycle | the page's own first logo | 16, 7, 8, 8, 6 | 0 other than the stored file | 5, 0, 3, 3 and 2 | Nothing to compare: keeps its logo |
| DermaAngel US | lifecycle | wordmark | 8 | 0 usable: the site's firewall turns a direct read of its SVG files away ("not a kind of file the design path uses") | 2 of 8 | Not proved here (below) |
| Kitcaster by Moburst | lifecycle | a thin-lettered lockup | 6 | none looked for: its website is a page on another client's site | 0 of 6 (0.468 to 0.568) | Never looked at, by rule (below) |
| Pay The Pyper | lifecycle, logo given by a person | the person's file | 4 | 1, not looked for | 4 of 4 | Never changed |
| Bader Law, Moburst | person | the person's file | 8, 8 | not looked for | n/a | Never changed |

### The first client: yesterday's 9 designs under the wordmark

The logo is the wordmark; each design is searched where the new settings put it (center, 0.148, top 0.902), as a job started from them would send it, over the canvas ground #5D4E4B. Pass, fail and file are compared exactly. The score of a design is recorded and not compared for a logo the rule chose, because it moves with the placement the rule gives (the choice's row pins that placement exactly).

| Job and design | Expected (diagnosis, old placement) | Got | Time | Same |
|---|---|---|---|---|
| 8b0145f4 design-1 | fail (0.341) | fail (0.338, at 0.42 of the usual width) | 1,690 ms | yes |
| 8b0145f4 design-2 | fail (0.301) | fail (0.293, 0.48) | 1,776 ms | yes |
| 8b0145f4 design-3 | fail (0.343) | fail (0.343, 0.45) | 1,703 ms | yes |
| 4d9f1b10 design-1 | fail (0.370) | fail (0.370, 0.49) | 1,709 ms | yes |
| 4d9f1b10 design-2 | fail (0.345) | fail (0.288, 0.43) | 1,739 ms | yes |
| 4d9f1b10 design-3 | fail (0.327) | fail (0.325, 0.43) | 1,687 ms | yes |
| df0c0a54 design-1 | pass, stored (0.962) | pass, stored (0.976, 1.17) | 1,799 ms | yes |
| df0c0a54 design-2 | pass, stored (0.968) | pass, stored (0.982, 1.17) | 1,760 ms | yes |
| df0c0a54 design-3 | pass, stored (0.952) | pass, stored (0.971, 1.17) | 2,019 ms | yes |

Under the icon the same 9 designs all failed locate (0.29 to 0.44). What this says and does not say: it says that the three designs in which the model kept the brand's wordmark are found, and the six in which it drew something else are not found, under the logo the posts carry. Whether the model keeps the wordmark more often with a canvas that carries it needs new paid designs and is not proved.

The 12 posts: found on 10 (0.815, 0.816, 0.955, 0.952, 0.992, 0.953, 0.986, 0.987, 0.979, 0.945), not found on 2 (0.456 and 0.440, shown at 0.47 and 0.49 of the usual width). Two of the 10 are white posts that carry a blue "quotes of" lockup whose shape the wordmark's copy matches (0.992 and 0.986).

The placement expected by hand from the diagnosis' rectangles (10 found, each as a share of its post's own width): widths 0.085 to 0.177 with a middle of 0.126; the usual width must hold 0.177 within 1.2 of it and 0.085 within 0.55 of it, which is a width between 0.1475 and 0.1545; the middle is below, so 0.148 (up to rounding). Top: the middle top is 0.902. Anchor center: the middle of every rectangle lies within 0.01 of the post's middle. The canvas ground expected by hand: of the 10 found posts, those the white wordmark shows on (contrast 3 or more against white: 6 posts remain, because the two white posts and the two light tan ones fall out), the ground with the smallest sum of distances to the others is #5D4E4B. The first run of the build had given #4F4E3A and 9 found posts, under a placement from before the width rule was corrected; it is not an expected value.

### Looked at

Every logo file and canvas the rule produces, at full size: the wordmark file (1,200 by 403, white ink) beside the stored icon; the wordmark as it is drawn on the canvas (160 by 54 pixels on a 1,080 pixel canvas) over #5D4E4B and over #0071FA, enlarged with no smoothing: clean, no halo, the counter of the "o" open. Six of the posts' found rectangles cut at their own pixels and enlarged to 1,240 pixels wide: the same white wordmark on a tan road, a dark road, green, and a dark brown floor; and the blue "quotes of" lockup on white. The icon of the stored file is a black circle with a speech bubble and appears on none of the 12 posts. Yangra's candidate (a navy lockup with the sun) and its stored file (white stacked lockup) were looked at beside six of its posts. Correction, 17 Nov after the review: the first version of this sentence said the posts show the horizontal lockup. That was wrong. Looked at again at full size with both rectangles drawn, the two posts where the candidate is found (0.766 and 0.792) show the stacked lockup, where the stored file is found at 0.973 and 0.969; the candidate's rectangle covers only the word "Yangra" and an empty stretch of ground to its left. Under the count of the revised rule those two posts are the stored logo's and the candidate has none (next section).

### What this does not prove

- DermaAngel US: no candidate could be read here because its host answers a direct request for its SVG files with a firewall page. The lifecycle makes the same direct request for files, so this may also hold in the product; whether the product's request is turned away is not known. Its stored logo is shown on 2 of 8 posts.
- Kitcaster by Moburst, the second client of the class "the stored file is on none of the posts although a logo was read on them" (0 of 6): its stored website address is a page on another client's site, so the rule is not applied and its logo does not change. The fix for it is its own website address, not a rule on posts.
- The homepages were fetched directly from a laptop. The lifecycle reads a client's homepage through the scraping service when it has a key, so a page that serves its header only to a browser may list more or fewer marks there.
- Counts for Yangra's candidate and for Buzznow's and European Wax Center's are the first run's values, not measured independently before the run.
- The service's own speed is not measured here.

## The logo the client's posts show: replay on the live reference posts, after the review (17 Nov 2026)

Rule: section 12 as revised after the review (the count by best score, a carried logo never replaced, only the brand's own marks as candidates, no SVG the page would color). Script: `server/scripts/tone-replay.ts`, unchanged in method.

- Posts: each row's live `reference_paths`, exported read only through the Lovable connector and fetched from the public bucket, 159 posts for the 14 rows (12 for each of the six lifecycle clients the first run held 8 of). This replaces the posts on disk of the first run, which held 8 of the 12 live posts for Buzznow, DermaAngel US, European Wax Center, Olo, PrepSmart Recipes and Yangra.
- Expected values: the posts, and how many posts the client's logo is found on, are the live step's own reads (`result.tone.posts` of each `design_settings` row), so every "current" count below is checked against what the product measured. Files, canvas and ground: `chooseSet` over those reads. The first client's posts, place, canvas and designs: as in the section above.
- Candidates: each row's stored website address, fetched directly (`site-logos.ts`), listed by `ownMarksOnPage`.
- Result, run at `6e9d2194`: exit 0, 0 of 244 rows differ. 15 entries, 10 choices looked at, 1 logo changed, 13 settings, 159 posts with a logo found on 60, 43 designs of which 30 pass. (This line first pointed to "the commit's proof", and the commit held no numbers. The re-check ran the same manifest at the same head and got the same rows.)

| Client | Row | Live posts | Posts that count for today's logo | Candidates | Found on, and posts that count for it | Result |
|---|---|---|---|---|---|---|
| Twos | lifecycle | 12 | 0 (best 0.501) | 1: the wordmark, inline SVG in the header's home link | found 10, counts 10 (0.815 to 0.992) | **Changes to the wordmark**: center, width 0.148, top 0.902; background #0071FA; canvas ground #5D4E4B |
| Yangra | lifecycle | 12 | 2 (0.973, 0.969) | 1: the site's whole logo, an SVG kept in a data address | found 2 (0.766, 0.792), counts 0: on both posts the stored logo scores higher | Keeps its logo |
| Buzznow | lifecycle | 12 | 10 | 1: the glasses mark alone | 0 (best 0.354) | Keeps its logo |
| European Wax Center | lifecycle | 12 | 0 | 1: its black wordmark (the second listed file is the stored one) | 0 (best 0.261) | Keeps its logo: no candidate carried |
| Adaptive Sound Technologies, BetterBee, Olo, PrepSmart Recipes, Uproar by Moburst | lifecycle | 16, 7, 12, 12, 6 | 5, 0, 8, 4, 2 | none other than the stored file | n/a | Keeps its logo |
| DermaAngel US | lifecycle | 12 | 3 | 1 listed, not read in this run: its host answered the laptop's request for its SVG with a firewall page | n/a | Not proved by this run. Corrected after the re-check: this cell said the client keeps its logo "even if fetched", which the code of this run did not hold. The candidate is replayed in the next section. |
| Kitcaster by Moburst | lifecycle | 6 | 0 | not looked for: its website is a page on another client's site | n/a | Never looked at, by rule |
| Pay The Pyper | lifecycle, logo given by a person | 4 | 4 | not looked for | n/a | Never changed |
| Bader Law, Moburst | person | 16, 16 | n/a | not looked for | n/a | Never changed |

What changed against the first run: Yangra's candidate counts 0 where it tied at 2, and the live posts change no client's result. Corrected after the re-check: this paragraph went on to say that a candidate could no longer take the place of a logo two posts carry, "which covers DermaAngel US whatever its host answers the product". Both halves were wrong for the code of this run. The count gave each post to the mark with the highest score, the client's own logo included, so a second file of the same logo could take the logo's posts by any margin. And the product does get files from that host: the re-check read the live row and found it written again on 17 Nov at 10:31 Israel time from the site's own SVG (`derived.logo_file` is `from_svg`), through the same read a candidate goes through. The next section holds the corrected rule and that client's candidate. The one logo that changes is the first client's, looked at at full size beside its posts again for this run (the wordmark over #5D4E4B; its posts' rectangles on the tan road and on the white post with the blue "quotes of" lockup), and the 9 designs of 16 Nov give the same rows as above under the live manifest: 3 pass (0.976, 0.982, 0.971 at 1.17 of the usual width), 6 fail (0.288 to 0.370).

What this run does not prove: whether the edge runtime reads the first client's homepage the way a laptop does (the release's check S3b reads it from the step's own result), and whether the model keeps the wordmark where a canvas carries it (the paid request of the release order, an owner decision).

## The logo the client's posts show: replay after the re-check (17 Nov 2026)

Rule: section 12 as corrected after the re-check (spec items 3 and 4; plan Rulings 73, 74 and 79 to 81; numbered 64, 65 and 70 to 72 before the merge with main). The logo the client has counts every post it is found on, whatever a candidate scores there, and a logo found on two posts or more is never replaced. A candidate counts a post only where it is found, scores higher than the client's logo (found or not) and no other candidate scores higher. Script: `server/scripts/tone-replay.ts`, unchanged in method.

- Manifest: the live manifest of the section above, with one change. DermaAngel US now has the candidate its homepage lists: the white file of its wordmark (`https://www.derma-angel.com/assets/img/layout/logo-w.svg`, a brand's own mark by `ownMarksOnPage`).
- How the candidate was read: one direct GET of that public file with the browser header the product's website read sends (`BROWSER_UA`): 200, `image/svg+xml`, 7,415 bytes, the same bytes the re-check had fetched. Converted by the design path's own conversion (`imaging.ts`, `logoPng`: drawn 1,200 pixels wide, trimmed to its ink), from a store kept in memory: 1,181 by 224, white ink, own ground dark. The conversion was checked against the product: the site's `logo.svg` through the same call gives the live stored logo byte for byte (the same SHA-256, which is also the hash in the stored file's name).
- Looked at at full size beside the stored logo, on one dark ground: the same wordmark, white where the stored file is teal. The two files have the same shape on every one of their 264,544 pixels (no difference in any alpha value).
- Expected row, written before the run (13:27:25 Israel time, the run started at 13:27:32): chosen null, the stored logo 3, the candidate 0. Every other expected value is unchanged from the section above.
- Result: exit 0, 0 of 244 rows differ. 15 entries, 10 choices looked at, 1 logo changed, 13 settings, 159 posts with a logo found on 60, 43 designs of which 30 pass. Slowest locate 8,062 ms, slowest read of one post 6,832 ms, on a laptop that was running another replay at the same time. Every row gives what the run at `6e9d2194` gave, except the one row that gained the candidate.

| Client | Row | Live posts | Today's logo is found on | Candidates | Candidate: found on, counts | Result |
|---|---|---|---|---|---|---|
| Twos | lifecycle | 12 | 0 (best 0.501) | 1: the wordmark, inline SVG in the header's home link | found 10, counts 10 (0.815 to 0.992) | **Changes to the wordmark**: center, width 0.148, top 0.902; background #0071FA; canvas ground #5D4E4B |
| DermaAngel US | lifecycle | 12 | 3 (0.907, 0.944, 0.900) | 1: the same wordmark in white | found on the same 3, counts 0: it scores higher on none of them | Keeps its logo |
| Yangra | lifecycle | 12 | 2 (0.973, 0.969) | 1: the site's whole logo, an SVG kept in a data address | found 2 (0.766, 0.792), counts 0 | Keeps its logo |
| Buzznow | lifecycle | 12 | 10 | 1: the glasses mark alone | found 0 (best 0.354) | Keeps its logo |
| European Wax Center | lifecycle | 12 | 0 | 1: its black wordmark | found 0 (best 0.261) | Keeps its logo: no candidate carried |
| Adaptive Sound Technologies, BetterBee, Olo, PrepSmart Recipes, Uproar by Moburst | lifecycle | 16, 7, 12, 12, 6 | 5, 0, 8, 4, 2 | none other than the stored file | n/a | Keeps its logo |
| Kitcaster by Moburst | lifecycle | 6 | 0 | not looked for: its website is a page on another client's site | n/a | Never looked at, by rule |
| Pay The Pyper | lifecycle, logo given by a person | 4 | 4 | not looked for | n/a | Never changed |
| Bader Law, Moburst | person | 16, 16 | n/a | not looked for | n/a | Never changed |

The first client's 9 designs of 16 Nov under the wordmark give the rows of the first section again: 3 pass (0.976, 0.982, 0.971), 6 fail (0.288 to 0.370).

### The two files of one logo, to six places

The stored logo against the white file on the three posts that carry the logo, measured with the replay's own reads:

| Post | Stored logo | White file as the product converts it | White file as a softer raster (the re-check's own file, 193 pixels enlarged to 1,200) |
|---|---|---|---|
| 6th | 0.906901 | 0.906890 | 0.920069 |
| 8th | 0.943629 | 0.943629 | 0.965763 |
| 9th | 0.899972 | 0.899957 | 0.926734 |

On the other 9 posts neither file is found (0.209 to 0.417, the two files within 0.00001 of each other).

| Rule | White file as converted | White file as a softer raster |
|---|---|---|
| As built at `6e9d2194` (the re-check's two runs, from the same scores) | stored 3, candidate 0: the logo stayed by 0.00001 on two posts and by the tie rule on the third | stored 0, candidate 3: the logo would have been replaced |
| As corrected (run on this tree) | stored 3, candidate 0: keeps its logo | stored 3, candidate 3: keeps its logo |

The softer raster is not what the product makes from this file. It is in the table because a small PNG of the same logo on some other client's site would be read like that, and the result must not turn on it.

### The class rule on the 14 homepages

`ownPaint` now takes a class as a paint only when the SVG's own style names it. Checked on the 14 homepages the site read kept (`site-logos.ts`, 17 Nov): the brand's own marks listed are the same as before on every page. The three inline SVGs among them (the first client's wordmark, Bader Law's and Yangra's) use no class and no style, and still count.

### What this run does not prove

- Whether the edge runtime reads the first client's homepage the way a laptop does (release check S3b reads it from the step's own result).
- Whether the model keeps the wordmark where a canvas carries it (the paid request of the release order, an owner decision).
- That the product's own request for the white file is answered at release. Its request for a logo file carries a shorter user agent than the one used here, and that host turned the laptop away with it twice on 17 Nov (the site read of the section above, and the re-check). The product's own request for `logo.svg` on the same host was answered that morning, as the re-check read from the live row. If the product is turned away, the file is no candidate and the client keeps its logo. If it is answered, the result is the row above.

## The replay after the merge with main at `22adbca1` (17 Nov 2026)

Run: `npx tsx server/scripts/tone-replay.ts` on the tree of commit `4ce38b09` (the merge, the lock file and plan Ruling 84), both manifests at the same time on a laptop running other work. No model call. The only network reads are GETs of the product's public storage, for the stored copies of each live set in main's manifest. Nothing was written outside a scratch folder. No manifest and no expected value was changed for this run. The script is the merged one (plan Ruling 82).

- The manifest of the section above (15 entries): exit 0, 0 of 244 rows differ (13 settings, 14 choices, 15 sets, 159 posts, 43 designs; 8 minutes 17 seconds). The first client changes to its wordmark, which 10 of its 12 posts carry while its icon is found on none: center, 0.148 wide, top 0.902, on #0071FA. Every other client keeps its logo. A logo was found on 60 of 159 posts, and 30 of 43 designs pass. Every row has the result it had in the run of the section above. A design row now also records main's three facts (the picture's ground, the weakest part there, and why a design is made again); no design of this manifest is lost on its ground.
- Main's manifest of its second review (29 entries): exit 0, 0 of 407 rows differ (25 settings, 29 sets, 270 posts, 14 windows, 69 designs; 10 minutes 19 seconds). 50 of 69 designs pass and 7 are made again as lost. Every row's expected value and result equal those of main's own second run.

Slowest locate 9.9 s and slowest read of one post 11.7 s, with the two runs sharing the laptop.

What this run does not prove. No entry holds a standing logo, so the count of plan Ruling 84 is proved by its tests alone (`logoPick.test.ts` and `steps.test.ts`), and by no row here. No entry has both a chosen logo and a live row, so no window row was run beside a chosen logo.

## The slot: replay on every stored design, with the real requests of 17 Nov (17 Nov 2026)

Spec section 13, plan rulings 85 to 98. Run: `npx tsx server/scripts/tone-replay.ts` on the tree of commit `f5fcaf6d` with the script of the commit that adds this section, both manifests at the same time on a laptop running other work. No model call. The only network reads are GETs of the product's public storage, for the stored copies of each live set. Nothing was written outside a scratch folder.

What a slot row is. Each design keeps the row it had (what the `locate` route still answers a worker from before this change) and gains a slot row: the service's slot search on the design, then the service's cleaned-slot function, with the stamp list a job would carry. The paid removal cannot be run here, so the cleaned picture is a stand-in: the design with the slot and its surround painted with the ground around it (the middle pixel of the ring). One design has its job's real logo-free picture on disk, and its row uses that.

Expected values were written before the run by a second, separate writing of the rule (a script outside the repository, from recorded measurements only: the earlier run's found or not and its ground around a found logo, the ground around the canvas rectangle, each file's whole-part colors, the posts' counts). For the nine designs of 17 Nov, which no earlier run has, the expected slot was written by hand from that day's measurements. No expected value was changed after a run.

Manifests: the two of the section above, unchanged, with the nine designs of the two real requests of 17 Nov added to the live entries of their clients, and the real logo-free picture named on its design.

- Main's manifest (29 entries): exit 0, 0 of 494 rows differ (25 settings, 29 sets, 270 posts, 14 windows, 78 designs, 78 slots). The 407 earlier rows keep their result, and the nine new designs fail the old locate as they did live.
- The manifest of section 12 (15 entries): exit 0, 0 of 287 rows differ (13 settings, 14 choices, 15 sets, 159 posts, 43 designs, 43 slots). The 244 earlier rows keep their result.

Every design gets a file: 121 of 121 slot rows name one, and none is made again for its ground. By what the old step gave the same design:

| The old locate | Designs | The slot | The file now |
|---|---|---|---|
| passed, stored file stamped | 65 | where the model drew it | the stored file, all 65 |
| passed, second file stamped | 13 | where the model drew it | the second file, all 13 |
| passed, white file stamped | 2 | where the model drew it | the white file, both |
| made again: found, and no file that could be named showed around the drawing | 7 | where the model drew it | the second file on 5, the white file on 2 |
| made again: not found | 31 | the canvas rectangle | the stored file on 8, the second file on 22, the white file on 1 |
| made again: not found (the three DermaAngel designs of 17 Nov) | 3 | where the model drew it, found in either tone at 0.918, 0.928 and 0.869 | the stored file |

So no design that passed before gets another file, and reading the search in either tone turns no earlier row from not found to found. The searches of the client's posts are unchanged (429 post rows, all as before).

The real requests of 17 Nov, each expected before the run:

| Design | Slot | Ground under it | File | Each file's weakest part there |
|---|---|---|---|---|
| European Wax Center 669ad0d8, design 1 | canvas rectangle (best match 0.547) | #620249 | the white copy | stored 1.62, copy 12.93 |
| 669ad0d8, design 2 | canvas rectangle (0.159) | #67034B | the white copy | 1.69, 12.42 |
| 3c85cc00, design 1 | canvas rectangle (0.162) | #080102 | the white copy | 1.02, 20.68 |
| 3c85cc00, design 2 | canvas rectangle (0.185) | #150203 | the white copy | 1.04, 20.16 |
| 6058c203, design 1 | canvas rectangle (0.684) | #D7C5F7 | the stored black file | 13.22, 1.59 |
| 6058c203, design 2 | canvas rectangle (0.643) | #D8C7F7 | the stored black file | 13.43, 1.56 |
| DermaAngel US b135df41, design 1 | where it was drawn (0.918) | #D4F0F5 | the stored cyan | stored 1.83, near-black copy 16.1 (last), white 1.19 |
| b135df41, design 2 | where it was drawn (0.928) | #D4F1F7 | the stored cyan | 1.85, 16.23, 1.18 |
| b135df41, design 3 | where it was drawn (0.869) | #D5F2F7 | the stored cyan | 1.86, 16.37, 1.17 |

The requests of 16 Nov. Pay The Pyper: the 18 designs on light pictures keep the stored file where the model drew it; cf6cbd60 design-1 keeps the copy with the white letter; design-2, which was delivered with two letters of three on a dark band, has the canvas rectangle as its slot and, on its job's real logo-free picture, the ground #1A1918 (flat 1.00, against 0.54 on the design before the removal) and the copy with the white letter (the stored file 1.00:1 there, the copy 6.03:1). Twos, with the wordmark its posts show: the three designs that drew the wordmark at its place keep it where it was drawn; the six that drew it above the headline or drew an outline of the old icon get the canvas rectangle and the stored white wordmark (2.74 to 15.98:1 on the wood under it).

Looked at, at full size (the area around the logo, 1:1): the nine designs of 17 Nov with the chosen file stamped by the finish function on the stand-in. The white copy on plum and on dark red velvet, the black file on lavender and the stored cyan on pale blue all read clearly; on the stand-in the painted area shows as a flat box on the velvet, which the real removal redraws. Scratch files: `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-slot/looks/`.

Slowest slot row 39.8 s on the loaded laptop (search and cleaned slot together, two runs sharing it); most take 2 to 8 s. The service's own speed is not measured here.

What this run does not prove. No paid step ran. Whether the removal takes out a drawing the search did not recognize is seen on one real picture only (the row above); the read for marks with its new question has not been asked once; the stand-in says nothing about how the real removal leaves a textured ground.
