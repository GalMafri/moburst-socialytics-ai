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
