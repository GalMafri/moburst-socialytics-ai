# The logo in the tone its picture needs

Status: live since 16 Nov 2026 (main `225a6340`). Section 11, added 17 Nov 2026, changes the rule after the first day of real requests: read it with sections 3 and 4, which it corrects in the places it names. What follows in this paragraph is the status of 16 Nov. Design, revised 16 Nov 2026 after two reviews, and again the same day after the review of the build (the changes are marked "after review"). Built on branch `qafix/logo-tone`; nothing of it is live. Owner decisions 1 and 2 (section 9) are not answered: no answer from the owner exists in the plan, the notes or this session as of this revision, so none is recorded here and the build has not been agreed. Section 9 says exactly what each answer keeps and removes. Decision 3 matters only after release. Written on branch `qafix/logo-tone` (from `qafix/picture-in-app` at `af747120`).

What was read: the diagnosis of 16 Nov (`adaptive-diagnosis.json`), its pictures and scripts, the code it cites in this branch, and both reviews of the first version of this document.

What was measured for this revision, locally, with no model call, no network and no write outside a scratch folder: the making rule of section 3, written out in full and run on the 14 stored logos and one drawn test file; all 111 reference posts on disk through this branch's own `findLogo`, `logoFound`, `canvasLogoRect` and `contrast`, with the two searches section 3 describes; and 17 stored designs of three clients through the same two searches. Scripts and results are in `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-r2/` (`rule.mts`, `evidence.mts`, `replay.mts`, `fixture.mts`, and their `.json` outputs). Every number below comes from the diagnosis or from these runs, and the text says which.

Gaps:

- For clients with more than 8 reference posts only the first 8 were on disk (all 16 for Adaptive Sound Technologies, 7 for BetterBee, 6 for Kitcaster and Uproar, 4 for Pay The Pyper). A client's result can change when all its posts are read.
- No logo-free picture of a failed job exists, so nothing after the locate step could be replayed.
- The full ids of the 17 design jobs are not on disk (the files carry their first 8 characters), and a read of the job table from this session was refused, so section 7 names them by prefix.
- The same-logo test for a website file was first tried only on each logo against a smaller copy of itself and against the other clients' logos. After review it was run on real pages (section 3, "Where a brand's own second file comes from"): 14 homepages, of which 6 were confirmed as the client's by their own logo. It met one real second file of a brand there and refused it for its width. The client rows could not be read in that session, so the addresses were tried by brand name. The proof on every client's stored website address is a step of the release (section 10).
- The one DermaAngel post that shows its logo in white shows it printed on a product box in a photo. No DermaAngel post on disk has a white logo placed on a design.
- Every time given is from a laptop. The picture service was not live on 14 and 15 Nov (diagnosis), so its speed on these searches is not known.
- Pay The Pyper's posts were searched with the placement in the diagnosis manifest (top 0.824, width 0.17), which was written for its untrimmed logo.

## 1. Goal and why

Every design carries a logo file of the client's: the stored file, the brand's own second file, or a recolored copy of the stored file that the client's own posts show. No design is thrown away because the model drew the logo in a tone the client's posts use and the settings did not hold.

Today the settings hold one logo file in one tone, and the locate step sends back every design whose picture needed the other tone. The diagnosis counts: Adaptive Sound Technologies has 0 of 45 design jobs done and Pay The Pyper 0 of 3. Moburst (99 static designs done), Bader Law (23) and BetterBee (1) work. Nine clients have never had a design made, and the diagnosis expects the same failure for Olo, DermaAngel, Twos, Buzznow, European Wax Center and PrepSmart Recipes. A failed option pays for up to three designs.

The fix gives each client a small set of logo files, lets locate recognize whichever of them the model drew, and stamps the file closest to what was drawn. A recolored copy enters the set only when one of the client's own posts shows the logo closer to that copy than to any other file of the set. The set is made from each client's own files and posts with nobody doing anything. It names no client, adds no gate and puts nothing new in a prompt.

What it reaches, measured on the posts on disk: the set, the canvas or both change for Adaptive, Pay The Pyper, Buzznow, Olo, DermaAngel and PrepSmart. Uproar and Yangra get a starting ground from their own posts. Moburst, Bader Law, BetterBee, European Wax Center, Kitcaster and Twos run exactly as today.

## 2. What is true today

### The path of a logo through a design

| Step | What happens | Where |
|---|---|---|
| Settings | One logo file per client (`logo_path`), one background. | `supabase/migrations/20261013200000_design_requests.sql:14-25` |
| Logo source | The website read keeps the first logo the page shows, as `clients.logo_url`. Nothing keeps a second file. | `supabase/functions/_shared/lifecycle/steps.ts:426-436`, `_shared/brand/research.ts:365-381` |
| Background | Chosen from the brand colors by contrast with the average color of the file's ink. | `steps.ts:1067`, `_shared/lifecycle/designSettings.ts:105-131` |
| Read of the posts | One model read of up to six posts asks only where the logo sits and how wide it is. It runs on every run of the step. | `designSettings.ts:41-49`, `_shared/lifecycle/imaging.ts:22`, `imaging.ts:158-177`, `steps.ts:1064` |
| Job | Each job copies `logo_path`, the placement and the background into its input. | `_shared/canva/jobs.ts:109-119` |
| Canvas | The background color with the logo file at its spot. The mask keeps only the logo's ink, so the model repaints everything else. | `server/src/picture/canvas.ts:15-29` |
| Prompt | "Its logo is final: keep it exactly as it is, where it is." | `_shared/canva/brief.ts:72` |
| Locate | The file, laid over the settings background, is searched for near its usual spot by signed correlation of brightness. | `server/src/picture/locate.ts:14-18`, `_shared/design/logoMatch.ts:130-135`, `logoMatch.ts:51-64` |
| The one test | Score at least 0.75 and a size the client uses. | `logoMatch.ts:184`, `logoMatch.ts:191-194`, `supabase/functions/design-worker/index.ts:270` |
| On a miss | The design is made again. After three designs the job ends. | `design-worker/index.ts:270-279`, `_shared/design/modelSteps.ts:22`, `modelSteps.ts:51` |
| Finish | The same `logo_path` file is blended in where the model drew its logo. | `design-worker/index.ts:341-350`, `server/src/picture/finish.ts:18-39` |
| After a closed request | The week's design button starts the post again. | `_shared/design/requestRules.ts:149-151` |
| Other readers | Every client picker and dashboard draws `logo_path` on `background`, and so do both previews of the settings card. The card's save writes the two back together. | `src/components/clients/ClientLogo.tsx:14-27` and `39-44`, `src/lib/activeClients.ts:16-21`, `src/components/onboarding/DesignSettingsCard.tsx:259`, `319` and `216-221` |

A white logo on a dark picture is the brightness inverse of a dark logo on a white ground, so the signed score is low and a correct design is sent back. Trimming the stored file (`_shared/design/logoFit.ts:32-57`) changes nothing here: a file that is already its ink alone takes the branch at `logoFit.ts:43-47`.

### The diagnosis, claim by claim

Confirmed against the code and by replay:

- The cause and every file and line the diagnosis cites match this branch.
- Its scores reproduce. Adaptive Sound Technologies, designs made with the current settings: the four light pictures score 0.919, 0.835, 0.960 and 0.907 and pass; the five dark ones score 0.314, 0.274, 0.308, 0.307 and 0.324 and fail. Against the same file in white, the dark ones score 0.964, 0.737, 0.931, 0.924 and 0.962. Pay The Pyper: 0.614 and 0.617 with the stored file, 0.971 and 0.980 with the black letter in white. (The diagnosis has 0.613, 0.617, 0.973 and 0.981; the small differences come from trimming the file to its ink first, as it will be stored.)
- One search takes about 3.1 seconds on a laptop for Adaptive's small logo, 1.2 to 1.6 seconds for Pay The Pyper's and 0.6 for BetterBee's.

Wrong or thin, and what this document does about each:

1. "It uses the brand's own reversed file when the site has one." No stored brand data holds a second logo file today. The website read returns the first match and stops (`research.ts:365-381`). Section 3 says where a brand's own second file can come from and how it is recognized.
2. "Ink that does not reach 3:1 turns the brand's darkest color on a light ground." A 3:1 rule alone recolors logos in ways the brand's posts never show: DermaAngel's cyan has 2.19:1 on white, so the rule makes its wordmark near black, while its posts show it in teal and in white. Section 3 keeps a recolored copy only when the client's posts show it.
3. "The brand's darkest color." The brand colors are a model's read of the website (`research.ts:178`). A made copy takes no color a model named. Its dark ink is #0B0E1A, the neutral the product already uses (`designSettings.ts:27`).
4. "Finish stamps that version, so the delivered logo always has the tone that shows on its picture." This fails for a logo of one mid-tone color. Olo's blue reaches 3.04:1 on white and 6.34:1 on #0B0E1A. On three of Olo's own posts the brand shows its logo in white, and the blue file still matches at 0.969, 0.948 and 0.978, because the score compares light and dark and ignores color. Section 3 adds a white file, puts it on Olo's canvas and stamps by color.
5. "One column for the second file." The set needs up to three files, who put each there, and the canvas choice, written together (section 4).
6. "A row a person set runs as today until a person adds a second version." That makes a person's step the fix. Section 3 treats those rows by the same rule and changes nothing a person set. This is owner decision 2.
7. "The settings background comes from the ground the client's own posts have at the logo's spot (the survey does exactly that)." The survey reads the logo's usual rectangle, which is the product default for five clients, and it takes the middle value of each color channel on its own, which can give a color no post has. Section 3 reads the ground around a logo that was actually found, as a real pixel. It leaves `background` alone and stores the ground it found in the set.

## 3. The design

### The idea in one paragraph

A client's logo becomes a set of up to three files: the stored file, a second file for the ground the stored file was not made for, and the logo in plain white. The second file is the brand's own when the client's data has one. Otherwise the second file and the white file are copies of the stored file with some ink in another color, made by one fixed rule, and each is kept only when one of the client's own posts shows the logo closer to that copy than to any other file of the set. The canvas carries the file most of those posts show, on the ground they show it on. Locate looks for the logo on a light and on a dark ground, keeps its single test, and names the file closest in color to what the model drew. Finish stamps that file where and at the size the model drew it.

### Words used below

- Ink: a pixel of a logo file with alpha of 16 or more (the number `designSettings.ts:136` already uses).
- Beside, touches, joined: two pixels that share an edge (up, down, left or right). Corners do not count.
- Part: a set of ink pixels joined to each other in which every two pixels that share an edge differ by at most 16 in each of red, green and blue. A part's color is the average of its pixels, weighted by alpha and rounded. A flat letter is one part. A smooth gradient is one part. Two flat colors that touch are two parts. Parts are numbered in the order their first pixel is met, row by row from the top left.
- A part's ink: the sum of its pixels' alpha, each divided by 255. The file's ink is the sum over all parts.
- Exposed part: a part with at least one pixel beside a pixel that has no ink, or on the file's edge. An inside part touches only other ink, like white letters inside a colored box.
- Small part: a part with under 1% of the file's ink, whether or not it touches another part. The blended pixels where two colors meet are small parts, and so is each letter of a small tagline. Every other part is a whole part.
- Light ground: #FFFFFF. Dark ground: #0B0E1A.
- A color shows on another: a contrast of 3:1 or more by the function the product already has (`designSettings.ts:95-98`), the same number `pickBackground` uses (`designSettings.ts:117`).
- A file's figure on a ground: sort its exposed parts, whole and small, by their contrast with the ground, lowest first, equal ones by part number. Walk the list, adding up ink. The figure is the contrast of the part at which more than 10% of the exposed ink has been passed. So 90% of the exposed ink reaches the figure.
- A file shows on a ground when its figure there is 3 or more.
- A file's own ground: the ground with the higher figure. Equal figures count as light.

### The making rule, step by step

The rule makes two candidate files from the stored file. It never changes alpha, so every edge and shape is the stored file's. A candidate is a recolored copy of the stored file. It is not the brand's file.

The copy for the other ground. Let G be the ground that is not the stored file's own, I the flat ink for G (white for the dark ground, #0B0E1A for the light ground) and J the other flat ink.

1. Each whole exposed part whose color does not show on G takes I. The others keep their color.
2. Whole inside parts, from the outside in, repeated until nothing changes: take, in part-number order, a whole inside part that is not settled and touches at least one settled whole part. The part around it is the settled whole part it shares the most pixel edges with (equal counts: the lower part number). If that part was turned and the inside part's color does not show on that part's new color, the inside part takes I when I shows on that new color, and J when it does not. Otherwise it keeps its color.
3. A whole inside part that touches no whole part at all is treated as in step 1.
4. Small parts, largest first (equal ink: the lower part number), repeated until nothing changes: a small part that touches a settled part is on the side of the settled part it shares the most pixel edges with (through other small parts, the whole part at the end), and takes what that whole part came to. If that part was turned, the small part takes that part's new color. If it was kept, the small part is kept. One case is treated pixel by pixel (added after review, so that no line of an old blend is left where two colors meet): a small part that also touches the side of another whole part, where the two whole parts came to different outcomes (one kept and one turned, or two turned to different inks). Each of its pixels that is a blend of the two parts' old colors keeps its mix: the share it had of each part's old color, it has of each part's new color. A pixel is a blend of two colors when it lies within 16 per channel of the closest point on the line between them. A pixel there that is no blend of the two takes its side's outcome as above.
5. The small parts still unsettled touch no whole part directly or through other small parts. They form groups, a group being small parts joined to each other. Each group is settled as one part: its color is the color of its largest member (equal ink: the lower part number). If that color does not show on G, every member takes I. Otherwise every member is kept. A small part that touches nothing is a group of one.

The white copy is made the same way with G the dark ground and I white, except that steps 1, 3 and 5 turn every part they reach, whether or not it shows. It is always made from the stored file.

A candidate is dropped when it is the stored file again. A whole part has changed color when any channel moved by more than 16. The copy for the other ground is dropped when the whole parts that changed color hold under 1% of the ink. The white copy is dropped when that is true against the stored file, or against the copy for the other ground. This compares part colors, so blended edge pixels never decide it.

Step 5 uses the largest member because a small letter's edge pixels carry a darker color than its body. Judged by the group's average, the gray tagline under Kitcaster's wordmark came out part gray and part dark in my first run. Judged by the largest member it turns as one (below).

### What the rule gives for the 14 stored logos

Measured in this revision. The sheet of all 14, stored file, copy for the other ground and white copy, each on its ground: `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-r2/candidates-sheet.jpg`. A gray cell means the candidate was dropped.

| Stored logo | Figures on light and dark | Own ground | Copy for the other ground | White copy |
|---|---|---|---|---|
| Adaptive (one blue) | 7.68, 2.50 | light | all white, 100% of the ink turned | dropped, same as the copy |
| Buzznow, European Wax Center, Twos (one dark ink) | 18.69 to 21, 1.03 to 1.09 | light | all white | dropped |
| Pay The Pyper (green and a black letter) | 2.91, 1.10 | light | green kept, the black letter white, 24.3% turned | kept |
| BetterBee (orange and purple mark, black wordmark) | 2.23, 1.09 | light | orange kept, purple and wordmark white, 62.7% turned | kept |
| Bader Law (white wordmark, red mark) | 1.00, 4.04 | dark | wordmark #0B0E1A, red kept (4.76 on white), 63.4% turned | kept |
| PrepSmart (white wordmark, orange mark) | 1.00, 5.32 | dark | wordmark #0B0E1A, orange kept (3.61 on white), 72.4% turned | kept |
| Moburst, Kitcaster, Uproar (white wordmark, mark in four light colors) | 1.00 to 1.02, 4.06 to 6.77 | dark | #0B0E1A throughout, 100% turned, every brand color lost | kept |
| DermaAngel (one cyan) | 2.19, 8.78 | dark | all #0B0E1A, 100% turned | kept |
| Yangra (one white ink) | 1.02, 10.49 | dark | all #0B0E1A | dropped, same as the stored file in every whole part |
| Olo (one mid-tone blue) | 3.04, 6.34 | dark, and it shows on light too | dropped, nothing turns | kept |

Kitcaster's file has 1,790 parts, 1,776 of them small, holding 29.4% of its ink. Under this rule all of it turns for the light ground, the tagline included.

Limits, each seen at full size:

- Three of the 14 lose every brand color in the copy for a light ground (Moburst, Kitcaster, Uproar). None of the three is used: their posts show the stored file (below).
- The 3:1 bar sits close to real brand colors: Moburst's and Kitcaster's pink has 2.87 and 2.88 on white and turns, Pay The Pyper's green has 2.91 and is kept only because light is that file's own ground, Olo's blue has 3.04 and is kept. A file just under the bar would turn where one just over it would not. This is why the bar never decides alone: a copy is used only when the client's posts show it.
- Where a kept color meets a turned one, the blended pixels between them first followed whichever side they shared more edges with, which left a thin line of the old blend along the orange in BetterBee's copy for dark. After review the rule's step 4 gives such a pixel the same mix of the kept color and the new one. Regenerated from the 14 stored logos: that one file changed in 254 pixels and its edge is clean at full size, and the other 21 files are byte for byte what they were.
- A stored file with hard edges gives copies with hard edges. Two of the 14 stored files have almost no soft alpha at their edges (Kitcaster 1% of its edge pixels, Yangra 3%, against 77% to 99% for the other twelve): their edge pixels are opaque blends with the backdrop they were cut from. In a copy each such pixel takes the full new ink, so Kitcaster's white copy has heavy, jagged letters beside its stored file. The cause is where the stored file is made (the backdrop cut of a JPEG or GIF, `_shared/design-system/logoAsset.ts`), which this design does not change: a fix there changes those clients' main logo file, and it could not be proven here because the files those two logos were cut from were not available (their websites show another logo today). Neither copy is in use, since no post of either client shows it. Decision 1 shows the owner both pictures.
- A copy carries the stored file's flaws. Yangra's file has specks of missing ink in three letters, and its copy has them too.
- Alpha is kept, so a part that is half transparent in the stored file is half transparent in the copy. Uproar's tagline is lighter than its wordmark in both.

### Which files a client's set holds

- The stored file, always. It serves its own ground, byte for byte, whatever its figure there.
- The second file, serving the other ground. In this order: a file a person put there on the settings card; the brand's own file from the client's website when one passes the same-logo test; the copy for the other ground, when the client's posts show it. When none of these exists and the stored file shows on the other ground too (Olo), the stored file serves both grounds. When it does not, no file serves the other ground, locate does not search for that tone, and a design whose logo is drawn in it is made again, as today. Recognizing a tone the set has no file for would deliver a logo that does not show where today the design is made again.
- The white file: the white copy, when the client's posts show it.

A person's file and a website file are the brand's own, so they need no post to show them. They are never recolored, and no white copy is made from them.

### Where a brand's own second file comes from

No stored data has one today (section 2, point 1). Two sources are added.

The settings card. A person may put their own file in the second place. This is optional and nothing waits for it. Details are under "What the settings card shows".

The website. The website read (`brand_read`) already has the page. It keeps a list of logo addresses in its stored result as `logo_files`, with no extra page fetched and no model called:

- Never from a text-only page (`steps.ts:395`).
- Looked at, in this order: the first `<header>`, the first `<nav>` outside it, the first `<footer>`.
- Inside each, in document order: every `<img>` whose `class`, `alt`, `id` or `src` contains "logo" in any letter case, and the header's first `<img>` whatever it is called (the element `logoOnPage` already trusts, `research.ts:369-371`). Each is read with `imgSource` (`research.ts:384-386`: `src`, else the first `srcset` entry, data addresses left out) and made absolute. Also every inline `<svg>` whose `class`, `aria-label` or `id` contains "logo", that is under 200,000 characters and has a drawing element (the test at `research.ts:372-373`). An inline SVG is stored the way the main one is, as `<client>/brand/logo-site-<hash>.svg` (`steps.ts:430-433`), so it has an address.
- The address that is the client's `logo_url`, and repeats, are dropped. The first six are kept.

Clients get the list when their website is next read (every 180 days, or when the site or the look changes, `steps.ts:380-388`). Nothing forces a read, so nothing is spent.

The `design_settings` step runs each address through `imaging.logoPng` (`imaging.ts:74-125`), the conversion the main logo gets: a PNG is kept, an SVG is drawn 1,200 pixels wide, a JPEG or GIF has its backdrop cut, the result is trimmed to its ink and stored as `<client>/design-settings/logo-site-<hash>.png`. An address that cannot be fetched or converted is left out.

The same-logo test, run by the picture service on those stored files against the stored logo, both already trimmed to their ink:

1. The width-to-height ratios are within 5% of each other.
2. Both are brought to 256 pixels wide and to the height the stored logo has at that width, so the two boxes lie corner on corner. Ink here is alpha of 128 or more. The overlap, shared ink over ink in either, is at least 0.9.
3. The file's own ground is the ground the stored file was not made for.
4. The file is at least as wide as the stored file, so it is never stamped more enlarged than the stored file would be.

When several pass, the one with the highest overlap is used, and the earlier on the page when equal. A file that fails is ignored. Measured on the 14 stored logos: a logo against itself redrawn at 61% size overlaps at 0.949 or more, and the closest two different clients' logos (Kitcaster and Uproar) overlap at 0.435. This compares two known files and gates no design.

Tried on real pages after review, with the product's own listing, conversion and test and no model (`supabase/tests/tools/site-logos.ts`, recorded in the replay record). 14 homepages were fetched directly. On 6 of them the page's own logo is the client's stored logo (overlap 0.997 to 1.000), so those are the pages the stored logos came from: Bader Law, BetterBee, Buzznow, European Wax Center, Olo and Uproar. They list 5 other logo files, and none passes:

- Bader Law's page has the brand's own file for light pictures, the same lockup with a dark wordmark and the red mark kept. Its shape agrees (1.000), its overlap is 0.980 and its own ground is light, so tests 1 to 3 hold. It is 261 pixels wide against the stored file's 1,068, so test 4 refuses it. Seen at full size beside the stored logo.
- Bader Law's footer file is the stored logo again at 142 pixels (same ground, overlap 0.884). Refused.
- Buzznow's second file is its glasses mark alone (shape 0.231). Refused.
- European Wax Center's two files are made for the same ground as its stored file (one of them the stored file again). Refused.

On the other 8 pages the page's logo is not the stored logo (the site shows another lockup today, an icon, or a file type the design path does not take), or the page gave no logo to a direct fetch; they list 3 more files that could be converted, and none passes. So the test has met one real second file and refused it, and it has not yet passed any real file. A wrong pass has not been seen, and a right one has not been seen either.

### What the client's posts show

For each of the client's stored reference posts (`reference_paths`, at most 16), the picture service does what locate does on a design:

1. Two searches at most, with today's `findLogo` near the logo's usual rectangle. The usual rectangle is `canvasLogoRect` with the row's placement and the post's own width and height, whatever its shape (`brief.ts:101-108`, as `locate.ts:15` does with a design). One search uses the stored file over its own ground. The other uses, over the other ground, the first of: the person's file, the website file that passed, the copy for the other ground, the stored file when it shows there. With none of those there is one search.
2. The better score is kept, the stored file's search when equal. The logo is found when `logoFound` holds for it, the same test and sizes a design gets.
3. For a found logo, each file is compared with the post at the found rectangle: the stored file, the second file or candidate (a person's file is left out), and the white candidate. The measure is the average distance between the post's pixel and the file's pixel, each distance the square root of the summed squares of the red, green and blue differences, over the file's solid ink (alpha of 128 or more) after the file is brought to the rectangle's size with `resampleRGBA`. The post shows the file with the smallest distance. Equal distances go to the stored file, then the second file, then the white file.
4. The ground around a found logo: take the found rectangle widened by a quarter of its width on each side and half its height above and below, clipped to the post, and leave out the rectangle itself. Starting at the widened rectangle's top left corner, take every second pixel on every second row. Sort them by brightness (0.299 red + 0.587 green + 0.114 blue, the weights `logoMatch.ts:23` uses), equal ones by position, and take the one in the middle (at index half the count, rounded down). That pixel's color is the post's ground. It is a real pixel of the post. The share of those sampled pixels within 16 per channel of it is the ground's flatness.

A copy is used only when at least one post shows it. A post that cannot be read is left out, on both sides: one that is gone from storage is not sent, and one whose bytes the service cannot read is null in its place. A post with no found logo says nothing.

The client's posts here are the row's `reference_paths`: the client's own published posts, and before them the pictures the team uploaded and kept as its references. Three of Moburst's four found posts are such uploads. An upload the team kept counts as a post of the client's, so it can be the post that shows a copy. Decision 1 says so.

Measured on the 111 posts on disk. A logo was found on 31 of them.

| Client | Posts read, with a found logo | What the found posts show | Files in the set |
|---|---|---|---|
| Adaptive | 16, 5 | the white copy on all 5 (distance 51.7 to 79.6, stored file 244.8 to 265.9) | stored, white copy as second file |
| Buzznow | 8, 6 | stored on 4, the white copy on 2 | stored, white copy as second file |
| Pay The Pyper | 4, 4 | stored on 2, the copy with the white letter on 2 (23.2 and 24.1, white copy 205.2 and 205.6) | stored, copy as second file |
| PrepSmart | 8, 3 | the copy with the dark wordmark on 2 (126.0 and 125.7, stored 230.2 and 230.3), stored on 1 | stored, copy as second file |
| Olo | 8, 3 | the white copy on all 3 (11.2, 26.0, 22.7, stored file 230.9, 224.5, 214.2) | stored (serves both grounds), white |
| DermaAngel | 8, 2 | the white copy on 1 (95.5, on a product box), stored on 1 (100.5, a teal logo on pale blue) | stored, white |
| Moburst | 8, 4 | stored on all 4 (18.7 to 49.0, white copy 134.3 to 156.0) | stored |
| Uproar | 6, 2 | stored on both | stored |
| Yangra | 8, 2 | stored on both | stored |
| Bader Law, BetterBee, European Wax Center, Kitcaster, Twos | 37, 0 | nothing | stored |

DermaAngel, said plainly. Its light-ground logo is a third color the app does not have: on one post the wordmark is teal on pale blue (a reviewer measured its ink at about 19,126,134). The rule's copy for a light ground is near black, 199.7 from that post, so it is not used. The stored cyan is the closest file at 100.5, so a design drawn that way is sent back as today, because cyan does not show on a light ground and no file serves that ground. The only automatic source for the teal file is the website list above, when the brand's site shows it. A person can also put it on the card.

PrepSmart's distances are high because its logo is a thin line drawn small. I looked at the three found posts at full size: two show the dark wordmark with the orange mark on cream, one shows the stored file on dark.

Limit: the search is near the logo's usual spot. Five clients have the product's default placement in the diagnosis manifest (BetterBee, DermaAngel, European Wax Center, Uproar and Yangra), which the step writes when the read of the posts gave no spot (`designSettings.ts:74-77`). Their posts that carry the logo somewhere else are not found. Two of European Wax Center's eight posts on disk carry its wordmark in white at the bottom, and nothing is found at the default spot at the top. Those clients run as today until their placement is read from their posts. That read is outside this document (section 8).

### How the canvas file and its ground are chosen

For a row the lifecycle wrote:

1. The canvas file is the file of the set that the most found posts show. Equal counts go to the stored file, then the second file. With no found post it is the stored file.
2. The canvas ground. Take the grounds of the posts that show the canvas file, and keep those on which the canvas file's weakest whole exposed part shows. Of these, the ground closest to the others wins (the smallest sum of distances to them), then the flatter one, then the earlier post. When none is left: `background` if the canvas file is the stored file, #0B0E1A if it is the white file or serves the dark ground, #FFFFFF otherwise.

For a row a person set, the canvas file is their logo file and the canvas ground is their background. Always.

`background` keeps its meaning and its value: the color behind `logo_path`, chosen as today (`steps.ts:1067`). The canvas ground is stored in the set (section 4), so every reader of `logo_path` and `background` in section 2's table is untouched.

Measured:

| Client | Canvas today | Canvas with this design |
|---|---|---|
| Adaptive | blue file on #FFFFFF | white copy on #0F294C (14.6:1), a ground two of its posts have |
| Olo | blue file on #0B0E1A | white copy on #2A95FD (3.08:1), its own blue. White does not show on its kraft ground (2.19), and its photo ground is less flat (0.02 against 0.995). |
| PrepSmart | white and orange file on #0B0E1A | copy with the dark wordmark on #F2EADF (weakest part 3.03:1) |
| Buzznow | black file on #FFCFDA | the same file on #F7E8E5 |
| Uproar | stored file on #0B0E1A | the same file on #192033 |
| Yangra | stored file on #181F36 | the same file on #151A42 |
| Pay The Pyper | stored file on #1A1A1A | unchanged. Posts are 2 and 2, so the stored file stays, and its green has 2.37:1 on the #E8E8E8 its light posts have. |
| DermaAngel | stored file on #0B0E1A | unchanged. Posts are 1 and 1, and cyan has 1.81:1 on the pale blue. |
| Moburst, Bader Law | their file on their background | unchanged, a person's rows |
| BetterBee, European Wax Center, Kitcaster, Twos | stored file on `background` | unchanged, no found post |

The canvas ground is only the color the model starts from. The model repaints it (the mask keeps the logo's ink alone). What a wrong start costs is not measured: the model can keep the canvas logo and pass, redraw it in another tone that locate now recognizes, or draw something locate sends back, which pays for another design. The existing cap of three designs per option bounds it. This measurement sets a starting value and passes or fails nothing.

### What the canvas carries

The canvas file on the canvas ground, at the client's usual spot, with the mask over its ink. The canvas call and the prompt do not change.

A job reads the set only when `logo_set.of` equals the row's `logo_path` and `logo_set.rule` is 1. Otherwise the set is stale or missing, and the job runs with `logo_path` and `background` exactly as today. A still job that reads the set gets:

```
input.logo_path            the canvas file
input.logo_size            the canvas file's width and height
input.placement            as today; a Story's placement is worked out from the canvas file's size (jobs.ts:111-113)
input.generate.background  the canvas ground
input.logos = {
  files:  { stored: <path>, other?: <path>, white?: <path> },
  canvas: "stored" | "other" | "white",
  second: { file: "stored" | "other" | "white", ground: "#FFFFFF" | "#0B0E1A" } | null,
  fixed:  [] | ["other"]
}
```

`second` is the template for the ground the canvas file does not cover: the file that serves that ground, laid over that ground. The canvas file covers the dark ground when it is the white file and the other ground when it is the second file. The stored file covers its own ground, with one exception added after review (16 Nov): a stored file that shows on both grounds has no one ground it covers, so it covers the ground its canvas color sits on, light or dark by which of the two neutrals that color has the lower contrast with (light when equal). Its second template is then laid over the other neutral, so the two templates are never the same file over the same color, which the service refuses, and never search one side twice. `second` is null when no file serves the other ground. `fixed` names a person's file. One pure function in `logoTone.ts` builds `input.logos` from the set, and `startOption` calls it.

(Replaced on 17 Nov 2026 by section 11: the 18 designs it describes were made and paid for on 16 Nov, and all failed.) A limit, said plainly. A stored file that shows on one ground only keeps that ground as covered even when its settings background sits on the other side. Pay The Pyper is the measured case: its own ground is light, its canvas is the stored file on #1A1A1A, and its second template is the copy on #0B0E1A. The canvas template there finds only a logo kept exactly as the canvas has it, and no template looks for the stored file on a light picture, although two of its four posts show that. A design drawn that way is made again, as today. The other choice, the stored file over #FFFFFF as the second template, was measured on its two stored designs on 16 Nov: it scores 0.369 and 0.332 where the copy over #0B0E1A scores 0.971 and 0.980, so both designs would go from pass to fail, and the templates stay. Searching both would take a third template, which this design does not have.

`startOption` does not change the settings object it was given or returns (`jobs.ts:91-97`). A video job is filled from that object as today and keeps the stored file (`jobs.ts:96`, `jobs.ts:162`).

No set is made when a design starts. A design that starts before the lifecycle has settled the client's set runs with the one file, as today. This removes any wait from a design's start.

### What locate takes and answers

Locate takes one or two templates and a list of files to compare. The first template is always the canvas file over the job's `generate.background`. The second is `input.logos.second` when it is not null. The compare list holds the set's files that are in neither template and not in `fixed`.

The service searches for each template with today's search. Of the matches that are the logo by the one test (`logoFound`: the score and a size the client uses) it keeps the better score, the first template's when equal; when none is, it keeps the better score of all, and the worker's test fails it as before (after review: a second template that scores higher at a size the client never uses can no longer turn a design that passes with the first into one that is made again). It answers that match's rectangle, score, usual rectangle (of the matched template's file) and frame as today. The worker's test is the same single `logoFound` on that answer.

Then the service compares colors, whichever template matched: the matched file, the other template's file and the compare list, minus any file in `fixed`, each by the distance of "What the client's posts show", step 3, at the found rectangle. It names the file with the smallest distance. Equal distances go to the matched file, then stored, other, white. When the matched file is in `fixed` (a person's file), nothing is compared and that file is named. The answer carries the named file, the matched file, each template's score and each distance.

What passes. The bar is the same 0.75 and the test is the same. The set of designs that pass is wider: a design now passes when either template reaches the bar. The highest score a failing design had in the replay is 0.737, 0.013 under the bar (a blue logo with a white outline the brand does not have). For a client whose canvas file and ground are unchanged, the first template is today's template, so a design that passes today passes with the same score. For a client whose canvas ground changed, the first template differs from today's in its ground color only. On Adaptive's five dark designs the white file scores the same to three decimals over #0F294C as over #0B0E1A on four, and 0.961 against 0.962 on one.

Replayed on the stored designs (section 7 has every row): of Adaptive's 9 designs under the current settings, 8 pass where 4 did. The four light ones match the stored file (distances 81.9 to 102.1, white copy 306.9 to 357.8) and are stamped with it. Four dark ones match the white copy (30.3 to 66.3, stored 263.3 to 285.3) and are stamped with it. Pay The Pyper's two designs pass at 0.971 and 0.980 and are stamped with the copy that keeps the green.

There is no plain dark file apart from the copy for a light ground. A brand's dark color and a neutral dark are too close for a choice by color to be steady: on one light Adaptive design the model's logo was 82.9 from the brand blue and 81.1 from #0B0E1A (first version's run).

### What finish stamps

The file locate named. The finish call does not change. The logo-removal, other-marks and word-check steps do not change.

### What the worker stores on the job

At locate, in the job's state: `logo_score` (the better score, as today), `logo_rect` and `logo_frame` (as today), `logo_file` (the path finish will stamp), `logo_named` and `logo_matched` ("stored", "other" or "white"), `logo_scores` (each template's score, in order) and `logo_gaps` (each distance). All of them are cleared with the rest when a design is made again (`modelSteps.ts:27`, `design-worker/index.ts:424`). Finish and the `picture_check` action read `state.logo_file` and fall back to `input.logo_path`.

### Rows a person set by hand

Owner decision 2. A person's logo file, placement and background are never changed. The canvas keeps carrying their file on their background, and the row's date for "set by your team" does not move. The set is made from their file and their posts by the same rule and stored beside it, so a design whose picture calls for a tone their posts show is recognized and stamped with that file.

Measured on the two rows a person set today: Moburst's four found posts all show its stored file (0.966, 0.989, 0.971 and 0.969), so its set is the stored file alone and nothing changes. No logo is found on Bader Law's posts, so nothing changes there either. The answer to decision 2 changes no design of either client with the posts on disk.

### What the settings card shows

The card speaks to staff about the client, as it does today (`DesignSettingsCard.tsx:249`).

- The line under "Logo file" (`DesignSettingsCard.tsx:270`) becomes "The client's logo file, best as a PNG with a transparent background."
- Once the set exists, small tiles under it, one for each kind of picture a file serves: "Logo on light pictures" and "Logo on dark pictures", each showing the file that serves it on a light or dark tile, and "Logo in white" when the set has a white file. Pictures no file serves have no tile (after review: an empty tile read as a missing logo, and with the sets of the replay record 9 of 14 clients would have had one). Under each tile, one of: "The client's logo file", "A light version of it", "A dark version of it", "A white version of it", "From the client's website", "Set by your team".
- One line below: "Each design carries the one its picture calls for."
- Nothing on the card says how a design is started. The first build had a "Designs start from" tile with the canvas file on the canvas ground; it explained the generator on a product screen and was taken out after review.
- One quiet control under the tiles, a link: "Choose a file for dark pictures" when the client's logo file was made for light pictures, "Choose a file for light pictures" when it was made for dark ones. Beside it, "Remove your team's file" while a person's file is there. Both act at once and are not part of the card's Save. Choosing runs the file through the same trim the main logo gets (`asPng`, `DesignSettingsCard.tsx:82-106`), stores it as `<client>/design-settings/logo-other-<file key>.png` in `generated-media`, and calls `set_design_logo_other` (section 4). Removing calls it with no path. Neither makes the row a person's: the logo file, placement, background and their date stay the lifecycle's. A tile shows a person's file from the moment it is saved. Designs use it once the lifecycle's next look has settled the set, which is queued by the same call. After a removal the tiles show what the set holds once it is settled again: the website file, else the copy when the posts show it, else the stored file when it serves both grounds, else no tile for those pictures.
- A person's second file belongs to the main logo it was put beside. When the main logo changes, it stops being used and the tile shows what the new set holds. The file stays in storage.
- The card's "Background behind the logo" field and both previews keep showing `logo_path` on `background`, and Save keeps writing them together, as today.
- Before the set exists the card looks as it does today, apart from the line under "Logo file". The card shows no state that asks for anything.
- Looked at after review in a headless browser with fixture rows, at 1,440 and 390 pixels wide: the client's file alone (made for dark and for light pictures), with a light version, serving both with the logo in white, with the logo in white, a row the team set, a file of the team's own, and before the set exists.

### What code decides and what the image model decides

Code decides: which files exist and what is in them, which of them the client's posts show, which one the canvas carries and on what color, whether the drawn logo matches one of the client's files at a size the client uses, which file is stamped, and where and how large it is stamped (where the model drew it, as today).

The image model decides: the picture, and so the ground behind the logo and the tone it draws the logo in. Nothing asks it for a tone, a color or a position. If it draws no logo, or one no file of the set matches, the design is made again, as today.

### Checked against the methods the owner rejected

- Brand elements rebuilt in code (rejected 1 to 13 Oct). The first version of this design collided with this: it made a recolored logo by a contrast rule and delivered it as the client's logo by default, and for DermaAngel that was a near-black wordmark the brand never uses. Changed: a copy is now used only when one of the client's own posts shows the logo closer to it than to any other file, the stored file is always among the files a stamp is chosen from, and a brand's own file always comes first. A copy is still a file made by code. That is owner decision 1, and the card says "a version of it".
- The model drawing the logo. Unchanged: the delivered logo is always a file.
- Positions or zones in a prompt. The prompt is not touched.
- Two blind parties composing one picture. Nothing is placed by rule. The stamp goes where the model drew.
- Moving elements after generation. Nothing moves.
- More checks and thresholds. The one gate stays `logoFound`, with its bar of 0.75 unchanged. What it accepts is wider, as said above. The other numbers (16 per channel, 1%, 90%, 3:1, 0.9, 5%) make and compare files. None of them passes or fails a design.
- Pixel-guessing gates. Pixel measures here draft: they propose a copy and a starting color. A copy is confirmed by the client's own published posts, through the product's own locate and a color distance between two known files and a found rectangle. No measure can fail a design. The rule needed one change after it was written out (the group color in step 5), and the note on gates says to stop when a rule starts needing exceptions. It is stated in full above so the owner can judge it on the sheet.
- The 8 Oct note "the variant is chosen from the ground under it". Not used. A choice by 3:1 against a measured ground would recolor working clients. The tone the model drew, compared by color with files the client's posts show, is the guide.
- One client as the target. The rule reads only a file and posts. The tables in this section are evidence from 14 clients, and no client is named in code or prompts.
- Manual steps and flags. None. The card's second file is optional, no state on any screen asks for one, and no tile is ever empty.
- Developer words on a client screen. The card is a staff screen and its new words are product words. Nothing new is shown to a client.

## 4. Data changes

### Column

On `public.design_brand_settings`, nullable, additive:

```sql
alter table public.design_brand_settings add column if not exists logo_set jsonb;
```

One column, so the files, who put each there and the canvas choice are always written in one statement.

```
logo_set = {
  of:     <the logo_path the set belongs to>,
  rule:   1,
  own:    "light" | "dark",                      // the stored file's own ground
  both:   true | false,                          // the stored file also shows on the other ground
  other:  { path, from: "made" | "site" | "person", size: [w, h] } | null,
  white:  { path } | null,
  made:   { other: <path> | null, white: <path> | null },   // what the service made, used or not
  site:   <path> | null,                         // the website file that passed the same-logo test, used or not
  person: { path, of, at },                      // only when a person put a second file; of is the logo_path it was put beside
  posts:  { read: <count>, found: <count>, shown: { stored, other, white } },
  canvas: { file: "stored" | "other" | "white", ground: "#RRGGBB", from: "client_posts" | "settings" | "pole" },
  at:     <time>
}
```

`posts.read` is how many of the row's reference posts the service could read, `posts.found` how many of those had a found logo, and `posts.shown` how many of the found ones show each file. They mean the same for a person's row. `from` is written by the server for server files and comes from `person` for a person's file, so nothing is inferred from paths. `person.of` settles what happens when the main logo changes: a person's file is used only while `person.of` equals `logo_path`.

`logo_path`, `placement`, `background`, `source` and `derived` keep their meaning. `derived` gains `logo_read_for` (below). No reader of `background` changes.

### Functions and triggers

- `settle_design_logo_set(p_client uuid, p_of text, p_person jsonb, p_set jsonb) returns boolean`, security definer, service role only. It writes `logo_set` only while the row's `logo_path` is still `p_of` and the row's `logo_set->'person'` is still what the caller read (`p_person`, null for none). It keeps the row's `person` key in what it writes. It never writes `logo_path`, `placement`, `background`, `source`, `confirmed_at`, `confirmed_by` or `updated_at`. It works on rows of either source. False means the row moved on, and the next look settles it again.
- `set_design_logo_other(p_client uuid, p_path text) returns void`, security definer, for signed-in staff who pass `can_write_client(p_client)`. It sets `logo_set.person` to `{ path, of: <the row's logo_path>, at }`, or removes the key when `p_path` is null, and calls `lifecycle_enqueue(p_client)`. It writes nothing else.
- `design_settings_mark_person` (`20261019220000_lifecycle_steps.sql:204-214`) marks a row as a person's on every write by a signed-in person. It gains one line: an update that changes nothing but `logo_set` leaves `source` as it is. Without it, replacing the second file would turn the whole row into a person's.
- A new trigger on `design_brand_settings`, after an insert or an update of `logo_path` by a signed-in person, calls `lifecycle_enqueue(client_id)`, so the set follows a person's first save and every later change of the main logo within the lifecycle's next look. Its function is security definer, because `lifecycle_enqueue` is revoked from signed-in users (`20261110210000_lifecycle_look_time.sql:39-40`).
- `lifecycle_write_design_settings` is unchanged. Row level security is unchanged.

### Storage

Copies are stored beside the stored logo as `<client>/design-settings/logo-<first 16 of the stored file's hash>-other.png` and `-white.png` in `generated-media`, website files as `logoPng` already names them, a person's second file as the card names it. The stored logo is never overwritten. A copy the posts do not show stays in storage unused.

### The lifecycle step, and the backfill it gives

No person runs anything and no client list exists anywhere. The work is in the `design_settings` step.

Its inputs key. A lifecycle row's key keeps today's parts (`steps.ts:1051`) and gains `|site:<first 16 of a hash of the website's logo files>|other:<the person's second file, when it is in use>|tone:1`. A person's row gets a key of its own, read before the step's other conditions, because it needs no website logo: `person|logo:<logo_path>|refs:<the same refs part>|site:<…>|other:<…>|tone:1`. Every client's key therefore changes once, and the lifecycle's daily look (`_shared/lifecycle/run.ts:3-13`) runs the step for each client.

One run of the step:

1. Settings, for a lifecycle row or a client with no row yet, as today: the logo file, the placement, the background, written through `lifecycle_write_design_settings`. One thing changes, the read of the logo's spot (next paragraph). A person's row skips this.
2. The files: one `logo-set` call (section 5) with the row's logo file, the website files and the person's second file. The service makes the two copies, stores them, tests the website files and answers the facts.
3. The posts: `post-logos` calls, four posts to a call, one call to a run. What each post gave is kept in the step's own result. While posts remain, the step ends as waiting and is looked at again in one minute (`policy.ts:76`, `policy.ts:87-93`), so a client with 16 posts is done in four short runs and no run holds more than one such call. After review: a read the service did not answer in time is asked again with half as many posts, down to one, kept in the step's result while its inputs stay the same, so a logo that is slow to search for still gets its set with nobody changing anything.
4. The choice, by one pure function in `logoTone.ts`: which copies the posts show, the canvas file and its ground.
5. `settle_design_logo_set`.

What `logo-set` answered is kept in the step's result too. A run that finds steps 1 and 2 already done for this key and this logo file (the stored result names the file) starts at step 3.

The read of the logo's spot. Today the step calls `readLogoSpot`, a paid model read, on every run (`steps.ts:1064`), and `previous` is null whenever the key changed (`run.ts:126`), which is exactly the backfill run. The step reads its own stored row through `rows` (`run.ts:126`), so the rule is exact:

- The read is about the client's posts and its logo. Call the `refs:` and `logo:` parts of the key the read's inputs.
- A stored read is current when the row is the lifecycle's, `derived` has a `logo_read` key, and either `derived.logo_read_for` equals the read's inputs, or `derived` has no `logo_read_for` yet and the `refs:` and `logo:` parts of the step row's old inputs key equal the new ones.
- A current read is reused, and no model is called. A stored read of null is a read that found no logo spot: it is reused as the default placement and is not asked again.
- Otherwise the model is asked as today, and `derived.logo_read_for` is written with the read's inputs.
- The model's key is asked for only when a read is needed.

So the tone change, the website list arriving and a person's second file make no model call for any client.

## 5. Contract changes

All in `supabase/functions/_shared/picture/contract.ts`, mirrored by `server/src/picture/schemas.ts`.

### New types

```ts
export type LogoFileName = "stored" | "other" | "white";
export type Ground = "light" | "dark";
/** One file to look for: its name in the set, its signed GET link, the color it is laid over, and whether it is a person's file. */
export type LogoTemplate = { file: LogoFileName; logo: string; ground: Rgb; fixed?: boolean };
export type Ink = { color: Rgb; share: number };
```

### Changed: locate

```ts
export type LocateRequest = PictureMeta & { design: string; placement: Placement; scales: [number, number] }
  & ({ logo: string; background: Rgb }
   | { templates: [LogoTemplate] | [LogoTemplate, LogoTemplate]; compare: Array<{ file: LogoFileName; logo: string }> });

export type LocateResult = {
  x: number; y: number; width: number; height: number; score: number; usual: Rect; frame: [number, number];
  file?: LogoFileName;                           // the file to stamp; present when templates were sent
  matched?: LogoFileName;                        // the matched template's file
  scores?: number[];                             // one per template, in the order sent
  gaps?: Partial<Record<LogoFileName, number>>;  // the color distances that were measured
};
```

A request has `logo` and `background`, or `templates` and `compare`, never both. The first template is the canvas template. One template is sent when no file serves the other ground. With equal scores the first template wins. `usual` is the usual rectangle of the matched template's file. `compare` may be empty and never holds a file that is in a template. A file name appears once in a request. The distance and its ties are as section 3 states them.

### Unchanged: canvas, finish, read, transcode, title-read

The worker passes the canvas file's link to canvas and the named file's link to finish in the existing `logo` field.

### New route: logo-set

```ts
export type LogoSetRequest = PictureMeta & { logo: string; site?: string[]; person?: string; out: { other: string; white: string } };
export type LogoSetResult = {
  size: Size; own: Ground; both: boolean;
  made: { other: { turned: number } | null; white: { turned: number } | null };
  site: { index: number; overlap: number; size: Size } | null;
  person: { size: Size } | null;
  inks: { stored: Ink[]; other: Ink[] | null; white: Ink[] | null };
};
```

`logo` is the stored file. `site` are up to six of the website's files, already stored by the lifecycle step. `person` is a person's second file. `out` are signed upload links for the two copies. `made.other` and `made.white` are null when that copy was dropped by the rule, and nothing was written for it. The white copy is always made from `logo`. `site` names the website file that passed the same-logo test, or null. `inks` are the whole exposed parts of the stored file, of the second file in the order of section 3 (the person's, else the website's, else the copy) and of the white copy, each with its share of the ink. The lifecycle uses them to test a canvas ground.

### New route: post-logos

```ts
export type PostLogosRequest = PictureMeta & {
  posts: string[];                                               // 1 to 4 signed links
  placement: Placement; scales: [number, number];
  searches: [LogoTemplate] | [LogoTemplate, LogoTemplate];       // the stored file's search first
  compare: Array<{ file: LogoFileName; logo: string }>;
};
export type PostLogo = { found: false; score: number }
  | { found: true; score: number; matched: LogoFileName; rect: Rect; gaps: Partial<Record<LogoFileName, number>>; shows: LogoFileName; ground: Rgb; flat: number };
export type PostLogosResult = { posts: Array<PostLogo | null> };
```

A post that cannot be read gives null in its place and the call still succeeds. `found` is `logoFound` on the better search. A template marked `fixed` is searched and never compared.

`PICTURE_ROUTES` becomes `["canvas", "locate", "read", "finish", "transcode", "title-read", "logo-set", "post-logos"]`. For the two new routes, `job` in `PictureMeta` is the client's id and `step` is "design_settings". Two files that list the routes change with it: the comment at `server/src/picture/routes.ts:3` and the list at `server/test/deploy.test.ts:59`. `vercel.json`'s rewrite of `/api/picture/(.*)` already serves the two new routes.

Everything that decides lives in one new file with no Deno or network imports, `supabase/functions/_shared/design/logoTone.ts`, which the service imports the way it imports `logoMatch.ts` today: parts, figures, own ground, the two copies, the same-logo test, the color distance, the ground around a rectangle, the choice of files, canvas and ground, and the job's `input.logos`.

### One side live before the other

The service's request checks refuse unknown fields (`schemas.ts:3-8`), and a refused call spends a try (`_shared/picture/client.ts:127-131`). So the order is fixed: the service first.

| Service | Workers | What happens |
|---|---|---|
| new | old | Old requests have `logo` and `background`. The new service answers them exactly as the old one, with no new fields. |
| old | new | The new worker sends `templates` only for a job that has `input.logos`. A job has `input.logos` only when a set exists, and a set can only be made by the new service's routes. With the old service those calls are refused, the lifecycle step waits, no set exists, and every job runs in the old shape. No design try is spent. |
| new | new | Sets are made, jobs carry them, locate names the file. |

Among the edge functions the order is the worker, then `design-request`, then the lifecycle's runner (section 10). Every pairing in between is safe: an old `startOption` reads `logo_path` and `background`, whose meaning has not changed (`jobs.ts:110-119`); a new worker meets no `input.logos` until `design-request` writes one; and no set exists until the lifecycle makes it.

A rollback, rewritten after review. The order above cannot simply be walked backward: the service ships with a push to main, and the edge functions can only be deployed from main's files afterward, so a revert puts the old service live under the new workers for a while. In that gap a job that carries `input.logos` would send templates to a service that requires `logo` and `background`, be refused, and lose its paid design. So the way back does not rest on deploy order. Its first step, with all code still new, takes the sets away with one statement and keeps a person's file, so every job started from then on is a one-file job under any pairing of old and new code. Its second step reads that no queued or running job carries `input.logos`. Only then is the revert pushed and are the functions deployed. The lifecycle's runner needs one more statement before it goes back, because the old runner computes the old inputs key: with the new keys left on the step rows it would see changed inputs for every client and run its old step, one paid model read of the logo's spot for each lifecycle client with posts. The plan's release section has each step with its statement and its check. The stored copies stay in storage, where nothing reads them. `background` was never touched, so nothing in the table was chosen for a file the old code does not use. A job that already carries `input.logos` and is picked up by an old worker runs with its `input.logo_path` and `input.generate.background`, which are the canvas file and its ground, a matching pair.

## 6. Failure behavior

In every row the client sees what they see today: a design being prepared, then a design, or a post with no design on it that the week's design button counts again. No new message exists anywhere.

| What goes wrong | What happens |
|---|---|
| The picture service is unavailable, slow or refuses during the lifecycle step | A new client's settings are still written the way they are today, so designs can start with the one file. The step keeps what it has, waits quietly and looks again in 10 minutes. |
| A design starts before the set is settled, or after the main logo changed | The job sees no current set and runs with `logo_path` and `background`, as today. Nothing waits. |
| The stored logo's pixels cannot be read, or it has no ink | The service says so. No set is stored. Designs run with the one file, as today. |
| A reference post cannot be read | It is left out, whether storage no longer has it (it is not sent) or its bytes cannot be read (the service answers null for it). With no found logo on any post the set is the stored file alone and the canvas is today's. Storage that could not answer right now is never taken for a missing post: the step fails with the lifecycle's backoff and reads the post on a later run. |
| A person's second file is gone from storage or cannot be read | It is left out and the set is made without it. |
| A website logo file cannot be fetched or converted, or fails the same-logo test | It is ignored. |
| Storage cannot take a copy right now | The service answers 503, the client's existing retry covers it, and the step tries again on its next look. |
| A person changes the main logo, or their second file, while the set is being made | The write holds only while `logo_path` and the person's file are what was read, so the person's change wins and the set is made again from it. |
| A person puts a file of another shape in the second place | It is used as given. Its usual rectangle comes from its own shape, it is stamped only when its own template matched, and it is never compared by color. |
| The model draws no file of the set, or draws one at a size the client never uses | The design is made again, as today, up to three designs. Then the option ends and the request settles as today. |
| The model draws the logo in a brand color on a ground of nearly that color | The closest file is stamped, as drawn. This is the case where a stamped logo can still be hard to see. See section 8. |
| Locate takes longer with two searches | About 6.2 seconds on a laptop for the slowest logo measured, inside the 60 second call limit (`contract.ts:29`). |
| Four posts in one `post-logos` call | Up to 6.0 seconds a post on a laptop in this revision's run (0.3 to 6.0), so about 24 seconds at worst (30.8 in a reviewer's run), inside the 60 second call limit and the function's 90 seconds (`vercel.json`). Not measured on the service. A call the service does not answer in time is a quiet wait, and the next read holds half as many posts, down to one. |
| A job from before the change, or a client with no set | The old request shape, the old behavior. |

Spend. No new paid call exists and no retry is added. The two new routes run in the app's own Vercel project. The lifecycle step makes no model call it does not make today, and fewer, because the stored read of the logo's spot is reused.

What does change is how far a design goes. Today a failing client's design stops at locate, so a failed option has paid for up to three designs and nothing after (`modelSteps.ts:22`). A design that now passes locate goes on to the logo removal, a paid image edit, up to four for one design (`modelSteps.ts:24`, `design-worker/index.ts:285-296`), to up to two cleans of other marks (`design-worker/index.ts:52`), and to the reads (other marks, the words, a Story's band, the area around the logo). So the worst case for one option is three designs, each with up to four removals, two cleans and its reads. These are the existing caps, and they are what an option of a working client can cost today. They have never run for the clients that fail today (diagnosis), so if those steps fail there, a request on such a client costs more than it does today, up to that bound. Nothing in this design starts a request: designs are made only when someone asks (`steps.ts:1036-1038`).

## 7. Tests

Test rasters use neutral made-up colors and counts.

### Rule, `supabase/tests/_shared/design/logoTone.test.ts` (rasters drawn in the test)

- "joins pixels within 16 per channel into one part, by edges and never by corners": a 400 pixel gradient is 1 part; two flat colors that touch are 2 parts; two squares that meet at a corner are 2 parts.
- "takes the ground with the higher figure as the file's own, and light when equal".
- "leaves the stored file untouched": the bytes handed in are the bytes that serve its own ground.
- "turns a dark one-color logo white for a dark ground": every ink pixel becomes (255,255,255).
- "keeps a color that shows and turns a black letter beside it white".
- "makes a near-black copy of a one-color logo that has 2.2:1 on white": the DermaAngel case with a made-up color. The choice test below then expects the stored file.
- "never splits a gradient".
- "leaves white letters inside a box alone when the box shows on both grounds".
- "turns a black box white and its white letters dark for a dark ground".
- "gives a blended pixel between a kept color and a turned one the same mix of the kept color and the new one", "keeps the mix across a blend two pixels wide", and "gives a small part that is no blend of its two sides the outcome of the side it shares more edges with".
- "turns a wordmark and its small gray tagline as one". The fixture: a 240 by 96 file drawn four times too large and averaged down, so its edges are blended. Six white bars, each from x = 42 + 140i to 132 + 140i and y = 42 to 230 on the large drawing. Sixteen gray (179,179,179) bars, each from x = 322 + 36j to 342 + 36j and y = 282 to 322. Each pixel carries its color times its coverage and alpha of 255 times its coverage, rounded. Measured with the rule of section 3: 180 parts, 174 of them small, holding 15.0% of the ink; own ground dark; in the copy for a light ground all 7,680 ink pixels are (11,14,26). Judging each part alone by its own color would turn 93.0%, so the test fails on that reading. The white copy is dropped.
- "judges a group of small parts by its largest member".
- "never changes alpha".
- "drops a copy that changes no whole part by more than 16 per channel", and "drops the white copy when it is the copy for the other ground".
- "gives the same bytes for the same file".
- "knows the same logo in another tone and refuses another logo, a copy on the same ground and a narrower file".

### What the posts show, and the choice, same file

- "says a post shows the file closest to it in color, and the stored file when equal".
- "uses a copy only when a post shows it": a post in a third color, closer to the stored file, leaves the copy out.
- "takes the ground around the found logo from outside its rectangle, as a real pixel".
- "carries the file most found posts show, and the stored file on a tie or with no found post".
- "takes the most typical ground the canvas file shows on, then the flatter one, then the earlier post".
- "falls back to the settings background for the stored file and to a neutral for another file".
- "keeps a person's file and background as the canvas, whatever the posts show".
- "gives the stored file both grounds when it shows on both, and no second template when nothing serves the other ground".
- "builds the job's templates, compare list and fixed list from a set", "covers the ground a both-grounds file's canvas color sits on, and searches the other one second", and "keeps the spec's templates for a file that shows on one ground only, wherever its settings background sits".
- "prefers a template that passes the size test over a higher score at an end of the sizes searched".
- `server/test/locateShapes.test.ts`: "accepts the locate request of every set a job can read" (every shape of set `jobLogos` accepts, through `locatePlan` and the service's own locate check) and "accepts the post-logos request of every set of files".

### Lifecycle, `supabase/tests/_shared/lifecycle/designSettings.test.ts`

- "reuses the stored read of the logo's spot when its refs and logo parts are unchanged, and calls no model".
- "reuses a stored read that found no spot".
- "asks the model again when the posts or the logo changed, and records what the read was made for".
- "reads four posts to a run and carries on where it stopped", "leaves out a post that is gone from storage, reads the others and settles the set", and "asks for half as many posts after a read the service did not answer in time, down to one, and still reads them all".
- "writes today's settings and waits when the picture service cannot be reached".
- "gives a person's row a key that changes with its logo and its second file", "makes the set for a person's row and leaves the logo, placement, background and date exactly as they are".
- "does not settle a set when the logo or the person's file changed while it was being made".
- "keeps the list of the website's logo files, without the main one, at most six" (`brand_read`), and "takes none from a text-only page".

### Database, `supabase/tests`

- "settles the set only while the logo and the person's file are what was read".
- "keeps the row the lifecycle's when a person replaces the second file", and "marks the row a person's when they save the card".
- "queues a look when a person saves a logo for the first time".
- "refuses a second file from someone who cannot write the client".

### Jobs and the worker's choice

- `supabase/tests/_shared/canva/jobs.test.ts`: "carries the canvas file, its size, its ground and the set in a still job's input", "leaves the settings it returns unchanged and gives a video job the stored file", "starts a job with the one file when there is no set or the set belongs to another logo", "works out a Story's placement from the canvas file's size".
- New `supabase/tests/_shared/design/logoChoice.test.ts` for the small function that turns a locate answer into state: "names the file the service named", "keeps today's state for a job with one file".
- `supabase/tests/_shared/design/modelSteps.test.ts`, "clears the logo's file, names, scores and distances when a design is made again".

### Contract and service

- `supabase/tests/_shared/picture/contract.test.ts`, "lists the eight routes". `server/test/deploy.test.ts`, the route list at line 59 names the eight.
- `server/test/routes.test.ts`:
  - "answers an old locate request exactly as before" (the existing fixture, the same answer object).
  - "answers the better of two templates, the first when equal, with each score".
  - "names the white file when the drawn logo is white on a mid-tone ground, whichever template matched".
  - "names a person's file when its template matched and compares nothing".
  - "takes one template".
  - "refuses a locate body with both a logo and templates, and a file named twice".
  - "writes the copies and says which it dropped" (logo-set), and "names the website file that passed".
  - "answers each post, and null for one it cannot read" (post-logos).

### Card

- `src/test/designSettingsCard.test.tsx`: "shows the logo for light and for dark pictures with where each came from", "shows the same tiles on a row a person set", "replaces the second file without making the row the team's, and brings back what the set holds", "shows no tile for pictures no file serves, and one quiet control beside the tiles", "looks as before when the set does not exist yet".
- `src/test/logoSet.test.ts`: "shows no tile for pictures no file serves", "names the one control for the pictures the client's logo file was not made for".
- `src/test/displayGuard.test.ts` passes unchanged.

### The measured designs and posts, as a replay

`server/scripts/tone-replay.ts <manifest.json>`, built like `server/scripts/replay.ts`. The manifest is exported read-only and is never committed, as with `replay.ts`. Its fields, one entry per client:

```
{ client, source, logo_path, placement, background,
  posts:   [<design-references path>, ...],                       // the posts measured for this document, in reference order
  designs: [{ job, design_path, placement, background }],         // job is the full id
  expect:  { files, canvas, ground, posts: [{ path, found, shows }], designs: [{ job, pass, file, score }] } }
```

The script reads the logo from `generated-media` and the posts from `design-references` by path. It trims the logo to its ink the way the lifecycle stores it (`logoNormalization`, `designSettings.ts:145-161`, then `resampleRGBA`) before anything else, makes the candidates with `logoTone.ts`, reads the posts, makes the choice, and runs the service's locate on each design. It exits 1 when a set, a canvas, a ground, a post's result, a design's pass or fail, or a stamped file differs. Pass or fail and the stamped file are compared exactly on every row. A score within 0.01 of the figure counts as equal.

The jobs. The export selects each by the first 8 characters of its id and must find exactly one row for each; the full ids were not readable for this document (gaps). Scores are from this revision's run, with the trimmed logo.

| Client | Job and design | Placement | First template, score | Second template, score | Expected |
|---|---|---|---|---|---|
| Adaptive | 84a0cd83 design-1 | top 0.04, width 0.25 | white copy on #0F294C, 0.458 | stored on #FFFFFF, 0.236 | fail |
| Adaptive | 84a0cd83 design-2 | same | 0.492 | 0.243 | fail |
| Adaptive | 75844f22 design-3 | same | 0.469 | 0.392 | fail |
| Adaptive | daa1be70 design-2 | same | 0.455 | 0.236 | fail |
| Adaptive | 29b0d751 design-1 | top 0.928, width 0.14 | 0.314 | 0.919 | pass, stored |
| Adaptive | 5853aaa3 design-1 | same | 0.323 | 0.835 | pass, stored |
| Adaptive | 3fef7ba7 design-1 | same | 0.299 | 0.960 | pass, stored |
| Adaptive | 93c83d46 design-2 | same | 0.350 | 0.907 | pass, stored |
| Adaptive | 0fcbcc71 design-1 | same | 0.964 | 0.314 | pass, white copy |
| Adaptive | 6db03b9e design-1 | same | 0.931 | 0.308 | pass, white copy |
| Adaptive | a5a3b7ec design-2 | same | 0.924 | 0.307 | pass, white copy |
| Adaptive | b543eb1d design-2 | same | 0.961 | 0.324 | pass, white copy |
| Adaptive | be7fccee design-1 | same | 0.737 | 0.274 | fail (0.013 under the bar) |
| Pay The Pyper | 53e1c25c design-1 | center, top 0.8709, width 0.1369 | stored on #1A1A1A, 0.614 | copy on #0B0E1A, 0.971 | pass, the copy with the white letter |
| Pay The Pyper | 20d0c025 design-1 | right, left 0.0666, top 0.8709, width 0.1369 | 0.617 | 0.980 | pass, the copy with the white letter |
| BetterBee | f553e4b3 design-1 | center, top 0.04, width 0.25 | stored on #FF9D2F, 0.373 | none | fail |
| BetterBee | f553e4b3 design-2 | same | 0.827 | none | pass, stored |

BetterBee's file as it is in storage today is 1200 by 295 with ink in 1177 by 290. Untrimmed it scores 0.361 and 0.817 on the two designs; trimmed, as the replay and the lifecycle step use it, 0.373 and 0.827.

The posts. The manifest carries, for each client, the posts measured here: the first 8 of its `reference_paths` as read on 16 Nov (all 16 for Adaptive, 7 for BetterBee, 6 for Kitcaster and Uproar, 4 for Pay The Pyper). The expected sets, canvases and grounds are the two tables of section 3. A logo is expected to be found on exactly these 31 posts, in the `design-references` bucket:

| Client | Post | Score | Shows | Ground |
|---|---|---|---|---|
| Adaptive | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-bb2628a6a3d0f67b2d4a50f1fa5d903bf591c29c840ac6598d4f9320c016ee35.jpg` | 0.954 | white copy | #3B3849 |
| Adaptive | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-f6f38cb95a28d91e34ce23a1b9fe80942803a3ef2ad4900091a18ff74a0c6c26.jpg` | 0.895 | white copy | #3B3946 |
| Adaptive | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-f2f3aef646cb52c47bb9ee050f3c44ac2cfa95bedafed54456d54b0609ca26d3.jpg` | 0.969 | white copy | #0C2A50 |
| Adaptive | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-5be8770a092138c3f1ed5e054253e195f9c6b15793bc417edb74fdeade3d12d2.jpg` | 0.969 | white copy | #0F294C |
| Adaptive | `9f43ec25-38c3-40d3-ae05-c01faeabc1d9/social-90941294b5ce2ca7acbf830eb7efd95415489066466eb4dfb6952b7b0dc410cf.jpg` | 0.938 | white copy | #0F294C |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-f11db90ffa589afa68c962acf8bb36fe35662dcacce9c238fe9274c31fe36595.jpg` | 0.897 | white copy | #838486 |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-6888a0657e1c508975ddcd1c885b176e294e6cd839cbfacb68a821fb05df9aff.jpg` | 0.983 | stored | #F7E8E5 |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-9a2abe67cb26f4ce0724737caaf3a2ec4741f44577fd46c185ac7e88ed000464.jpg` | 0.958 | white copy | #4D2B08 |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-2f485669c28ca88a0a9e852dc21670a868df3ea51d6363a4205a617d6c9f2a9e.jpg` | 0.956 | stored | #F7E8E5 |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-bb764a6c93e1b952f6bd71c135d58d40da46b33aaae1342a0557017b428ab9dd.jpg` | 0.984 | stored | #FBF4EA |
| Buzznow | `36210d1f-a27f-4f76-be97-9eb2e4ecaa58/social-e9b88a48ed373d565b88017b967cdd100a6fd5d6fdabde0a1e4abfbda6659a5a.jpg` | 0.957 | stored | #F7E8E5 |
| DermaAngel | `ed267046-def3-4a2b-8e04-c4d1075602c8/social-86bcc4b142d0649513eaa62fa48ca2eec7d96209e98ff3ac98ebc93ca712484c.jpg` | 0.907 | white copy (95.5, stored 173.0) | #01BEDC |
| DermaAngel | `ed267046-def3-4a2b-8e04-c4d1075602c8/social-8df20e5ecc1cf85533e5d613e92fee889a39fe94b6fc0f6f7a8ea3ac3c48b81f.jpg` | 0.944 | stored (100.5, near-black copy 199.7, white copy 246.2) | #D5EEF5 |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453062895-oosy.jpg` | 0.966 | stored | #104469 |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453063810-b68a.jpg` | 0.989 | stored | #185581 |
| Moburst | `Moburst/d00ce604-2bcc-455a-9826-f80250db75cf-1777453065522-q65a.jpg` | 0.971 | stored | #1E394C |
| Moburst | `d00ce604-2bcc-455a-9826-f80250db75cf/social-ea5a96f6dd117bf720ed3193a4e295347cfa2da73d51153228a5f39867215aff.jpg` | 0.969 | stored | #090911 |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-c7b9a27232f17d7ead7cbe42c9149aa24791a7bf353ad6f1fb0db4ce11d9f3de.jpg` | 0.969 | white copy | #C7AB86 |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-c56fe2915498ae41ef6e12dcf1ef3c054bf83a94e6f0d0ef3e17833bf5f62d8b.jpg` | 0.948 | white copy | #563723 |
| Olo | `dbd1cb23-ff1a-44bc-946b-514d995235e6/social-eacaeab2132ae761cf44ba532d413d09e3fa0f967e03ed0a6a8d869a1da21223.jpg` | 0.978 | white copy | #2A95FD |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-7e41476edb23c66760d0d456fa115466ccf84ac616e5ca761404c312dfc8bfdf.jpg` | 0.988 | stored | #E8E8E8 |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-f5113c68a595ef3bb043bd35af80fa09a19a45ce9601a5c5e2842e07528325f0.jpg` | 0.979 | stored | #E8E8E8 |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-d4812fea5bfb594d35a0c70653aa53d09c154f43ffe10ada34daca27ea4e79eb.jpg` | 0.987 | the copy | #1A1A1A |
| Pay The Pyper | `ed9c986c-a7ed-4c32-aa2e-c301f884a325/social-ed50bb879d4f4450d64c0d3e6c2cfdbee72b2d5ebf96aa2d2250551f82e4dd36.jpg` | 0.984 | the copy | #1A1A1A |
| PrepSmart | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-051723f29c806b29f3f77a4bc9640735569952107d166f5b531726f9729e9658.jpg` | 0.773 | the copy | #FCF3E4 |
| PrepSmart | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-15c31558800cf55987667de284fd21fadf9522dc47d9825ae6719803e4624e7f.jpg` | 0.761 | stored | #1E1B16 |
| PrepSmart | `40f08c97-0558-4b19-883b-c5af0f86b1aa/social-6221ab134380280c0fed658e59ded855ca57bfd293cfc6f086a2e0af1a545d05.jpg` | 0.756 | the copy | #F2EADF |
| Uproar | `a471e187-5e48-4aaa-bbb6-d571056f3795/social-2d30612ac0746c1a44a3f42a49ee4b5b0f730b3c4c19033eb3bfc5039542afa9.jpg` | 0.966 | stored | #192033 |
| Uproar | `a471e187-5e48-4aaa-bbb6-d571056f3795/social-59f3ba3c7bcbe50fba446b550cbd361531c2cc7156cb2ed8661d5b8976e473d5.jpg` | 0.907 | stored | #1A4565 |
| Yangra | `925faba1-4d0a-4e4d-b300-41c6fe28b73f/social-cbe5950559b1db8320e55223bd57fd6f02fa0907e2b4f95040932822faf96468.jpg` | 0.973 | stored | #0342AB |
| Yangra | `925faba1-4d0a-4e4d-b300-41c6fe28b73f/social-cb1b07102b573402cfb6911f8de734b40717f75704bffcb9861d03815b94425f.jpg` | 0.969 | stored | #151A42 |

PrepSmart's three rows are within 0.025 of the bar. Their found or not found is asserted exactly, like every row.

## 8. Non-goals and anti-goals

Non-goals:

- Video. A video's logo is the stored file laid over footage (`jobs.ts:162`, `_shared/video/steps.ts:335`). It has no locate step and is not changed here.
- The wrong asset. Twos' stored file is its round icon while its posts carry its wordmark (QA item R5). No recoloring fixes that; the set is made from whatever file is stored.
- Where the logo sits. Five clients have the product's default placement (section 3). Their posts are searched at that default spot, so a logo placed elsewhere gives this design nothing to go on, and they run as today. Reading the spot better is its own piece of work.
- A logo in a color the app has no file for (DermaAngel's teal). The website list and the card are the two ways such a file arrives. Nothing here invents it.
- A contrast gate. No design is failed for how well its logo shows. The remaining weak case is a logo the model draws in a brand color on a ground of nearly that color. It is as visible as the model drew it. The distances are stored on the job, so a later decision can rest on real designs.
- A plain dark file apart from the copy for a light ground, and any choice by the measured ground's contrast. Both were measured and set aside in section 3.
- Reading logo colors out of the client's posts, or taking a made ink from the brand colors.
- Changing the 0.75 bar, the sizes searched, the placement, the prompt, the mask, the meaning of `background`, or the steps after locate.
- Clients with no design settings yet (two today, per the diagnosis). They get the set when they get settings.

Anti-goals, any of which would make this a failure even if designs pass:

- A client's name, a client's color, or a position, in code or in a prompt. The two neutral inks #FFFFFF and #0B0E1A are the only colors in code, and the product has both already (`designSettings.ts:27-28`).
- A logo drawn by the model in a delivered picture, or a stamped logo moved from where the model drew it.
- A recolored copy on a canvas or in a delivered picture for a client whose own posts do not show it.
- Anything a staff member or a client has to do before designs work, or a message telling them to.
- A new way to spend: a model call the step does not make today, or a retry that pays for another design.
- A change to anything a person set.

## 9. Owner decisions

Neither decision 1 nor decision 2 has an answer yet. The document is written for yes on both. What a no removes is listed, so the build can start from either answer without another design round.

1. May the app keep a recolored copy of a client's logo, made by the rule in section 3, which changes ink color only and never a shape, for a client whose own posts show the logo closer to that copy than to any other file it has, and whose data has no second file from the brand? Recommendation: yes. To look at with this decision: the sheet of all 14 logos (`/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-r2/candidates-sheet.jpg`), where three of the 14 lose every brand color in the copy for a light ground and none of those three is used; the three colors that sit at the 3:1 bar (2.87 and 2.88 turn, 2.91 and 3.04 are kept); and DermaAngel, whose copy for a light ground is near black and is not used because its posts show teal. With the posts on disk a copy would be in use for six clients: Adaptive, Buzznow, Olo and DermaAngel (the logo in white), and Pay The Pyper and PrepSmart (part of the logo turned).
   Three things added after the review of the build, to be judged with this decision:
   - A copy that is not in use today turns on by itself, with no person deciding, in the week one of the client's reference posts shows the logo closer to that copy than to any other file. Reference posts refresh weekly, and one post is enough.
   - "The client's own posts" are the client's reference posts as the settings hold them: its published posts, and the pictures the team uploaded and kept as its references. An upload the team kept can be the one post that shows a copy.
   - Two of the 22 made files are not as clean as the stored files they come from, and neither is in use. Kitcaster's white copy has heavy, jagged letters, because its stored file has hard edges (enlarged: `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-build/logos/z-c06-white.png` beside `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-build/logos/z-c06-stored.png`). Yangra's copy for light pictures is coarse for the same reason and carries the specks of its stored file. Both would be stamped on designs as they are if a post of that client showed them. The cure is in how those clients' main logo file is cut from its picture, which this design does not change (section 3, limits). A third file, BetterBee's copy for dark pictures, had a line of old color along its orange shape; that was fixed in the rule and the file is clean now (enlarged, before and after: `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-build/fix/z-c02-other-old.png` and `/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/logo-tone-build/fix/z-c02-other-new.png`).
   If no: the service makes no copies, the white file does not exist, and a set holds the stored file and at most a person's or a website file. Section 3's rule, its tests and the `made` keys go. Adaptive and Pay The Pyper then keep failing on the pictures they fail on today until the brand's own second file arrives from the website list or the card. Olo passes locate with its blue file on both grounds and is stamped with it.
2. Should rows a person set (Moburst and Bader Law today) get a set by the same rule, with their own file, placement and background left exactly as they are? Recommendation: yes. With the posts on disk it changes nothing for either: Moburst's posts show its stored file and no logo is found on Bader Law's.
   If no: the step keeps answering "person" for those rows as today (`steps.ts:1049`), a person's row gets no key of its own and no set, and the tests named for a person's row go. The card's second file then exists only for lifecycle rows.
3. After release, may one paid design request be made for one client that has never finished a design, to prove the steps after locate, which have never run for those clients? Recommendation: yes, at once after the last deploy. Everything before that step is proven without spending. It is a step of the release order (the plan's step 9), and its job row is read before anything is said to anyone.
   What the owner should know with this decision, in plain numbers. Today a failing client's option stops at locate and has paid for at most 3 designs. With this change a design that passes locate goes on, so the most one option can pay for is 3 designs, 12 logo removals (up to 4 for each design) and 6 cleans of other marks (up to 2 for each design), plus the reads. These are the caps a working client's option already has, and nothing new starts a request. For the clients that fail today these later steps have never run, so until the paid proof has passed, a request on such a client can cost more than it does today, up to that bound.

## 10. Rollout

Before anything: the picture service is live. It answers `/api/health` on the app's Vercel domain and the worker's `picture_check` passes. It was not live on 14 and 15 Nov (diagnosis).

Order:

1. Migration: the column, the two functions, the changed and the new trigger. All additive; the old code ignores the column.
2. Picture service: `logoTone.ts`, the two new routes, and locate with templates. It ships with a push to main, as a function of the app's own Vercel project. Old requests are answered as before.
3. Edge functions, in this order: the design worker (locate and finish read `input.logos`, and none exists yet); `design-request` (`startOption` writes `input.logos` when a current set exists, and none exists yet); the lifecycle's runner (the `design_settings` step and the website read's `logo_files`). From the runner's deploy the daily look makes each client's set.
4. The card.

Why this order is safe for spend. Nothing here starts a design. A request starts only when a person presses a button, and each option is bounded by the caps in section 6. The paid proof (decision 3) is one request made by us at once after step 3, on a client whose set changed, and its job row is read before anything else is said to anyone. If its later steps fail, the way back of section 5 is taken, in its order (the sets taken away first), and clients are where they are today.

Proof with no spend, in this order:

1. The tests of section 7 pass, and `tone-replay.ts` passes on the 17 designs and the 111 posts from storage.
2. After step 2: the worker's existing `picture_check` action (`design-worker/index.ts:494-530`) runs the finish route on the newest done designs, which shows old requests are served unchanged. A new worker action, `tone_check`, built like `picture_check` and writing nothing, runs the live `logo-set` and one `post-logos` call for one client's stored logo and four of its posts and reports the times, which gives the service's speed for the first time. It has a pass line (after review): run for the client whose locate was slowest in the replay and for one client whose posts get two searches, it answers `ok: true` and its read of four posts takes under 30,000 ms. A slower answer stops the release before the runner is deployed. These two calls are also the only proof that the new routes are the ones live on the domain, since the health check and `picture_check` pass on the old service too.
3. Before the runner is deployed (after review): the website second-file proof on every client's stored website address, `supabase/tests/tools/site-logos.ts`, free and with no model. Every file that passes the same-logo test is looked at at full size beside the stored logo. A pass that is not the client's logo stops the release. Its first run, on 14 homepages tried by brand name, is in the replay record: 0 files passed.
4. After step 3: every row of `design_brand_settings` has `logo_set.of` equal to its `logo_path` once the lifecycle has looked at each client (a read of the table). No step row shows a model read made by the tone change (`derived.at` unchanged where the posts and logo are unchanged). The rows a person set have the same `logo_path`, `placement`, `background` and `updated_at` as before, and every row has the same `background` as before.
5. `tone_check` on stored designs of ended jobs: it runs the live locate with the client's live set and reports the matched file, the named file, the scores and whether `logoFound` holds, writing nothing. Expected on Adaptive's 9 designs under the current settings: 8 found, 4 stamped with the stored file and 4 with the white copy, and every locate with two templates under 30,000 ms.
6. The card, opened for one lifecycle client and one client a person set, shows a tile for each kind of picture a file serves, no empty tile and no new state.

What needs a paid design: the logo removal, the other-marks read, the finish and the word check on a design that carries a copy have never run for the clients that fail today, and whether the model keeps the canvas logo more often with the new canvas can only be seen on new designs. One request for one post (decision 3) proves the first. The second shows up in the stored `logo_named` and `logo_matched` of the designs clients ask for, with nothing extra spent.

## 11. The logo on the ground it was made for (17 Nov 2026)

Written before any code of this change. Branch `qafix/tone-ground`, from main at `e2024c9f`.

### What happened on 16 Nov

One client asked for designs three times. Read from its job rows and its stored pictures on 17 Nov, with no model call:

- Its stored logo is two green letters and a near-black letter, made for light pictures (figures 2.91 on light, 1.10 on dark). Its settings background is #1A1A1A, one of its brand colors. `pickBackground` chose it against the average color of the file's ink (51,136,70), which has 3:1 or more on it. The near-black letter has 1.01:1 there. So the canvas of every design showed two letters of three.
- 18 designs of 6 options drew the stored logo on a light picture, at the usual spot and size (0.89 to 1.07 of the usual width). Locate compared them with the file over #1A1A1A and scored 0.39 to 0.48 against the bar of 0.75. All 18 were made and paid for, and all 6 options failed.
- The same search with the file over a light ground passes all 18: 0.833 to 0.980 over #FFFFFF, and 0.833 to 0.979 over #E8E8E8, the ground the client's own light posts have.
- One option ended ready. Its first design drew the near-black letter in white on a dark band (0.606 over #1A1A1A, 0.962 for the copy with the white letter over #0B0E1A) and was sent back. Its second kept the canvas logo as it was, two letters of three on a dark band, scored 0.974 and was delivered that way.
- The logo set of section 3 would not have changed any of this. Its two templates for this client are the stored file over #1A1A1A and the copy over #0B0E1A, so no template has the stored file on a light ground. Its canvas stays the stored file on #1A1A1A, because the two light posts where the stored file is found (0.987 and 0.984, color distance 24.3 and 19.4, ground #E8E8E8) are left out for the green's 2.37:1 on that ground, and the fallback takes the settings background without testing each part there.

The same fault is in a second client's settings: an orange and purple mark with a black wordmark on its brand orange #FF9D2F, where the orange half of the mark (37.1% of the ink) has 1.08:1. Its canvas shows the mark without that half. Both canvases were looked at at full size.

Cause, in one sentence: a file was laid on a ground that was chosen for the average of its ink, and one whole part of it does not show there.

### The rule

Words. A file shows whole on a color when every whole exposed part of it has 3:1 or more there (the parts and the 3:1 of section 3). A file serves a ground as section 3 says: the stored file its own ground, and the other one too when it shows on both; the second file the ground the stored file was not made for; the white file the dark ground.

1. The settings background. `pickBackground` takes the brand color on which the file's weakest whole exposed part has the highest contrast, when that contrast is 3:1 or more. With no such brand color it takes the neutral of the file's own ground. The average ink is no longer used when the parts can be read. The lifecycle reads the parts where it already reads the ink, from the file it stores, with no call to anything.
2. Where the stored file rests when no post says. On the settings background when the file shows whole on it. Otherwise on the neutral of its own ground. This is read when a design starts, from the row's background as it is at that moment and the file's inks kept in the set, for every row, a person's too. A person's file, placement and background are never written. Their background is what a design starts from whenever their file shows whole on it, which holds for all three rows a person set today (weakest part 3.58, 6.70 and 19.70).
3. What a post says about a ground. A found post counts for a file's ground when that file's own search is the one that found the logo there. The white file has no search of its own and counts when it is the file closest in color. A post where another file's search found the logo and the color step then named this file says nothing about this file's ground: the brand's logo is there in a color the app has no file for (one client's teal logo on pale blue is the measured case, found by the near-black copy's search and closest in color to the stored cyan at a distance of 100.5).
4. The canvas ground. Of the grounds that count for the canvas file, those on which it shows whole come first, and among them the choice is as before (closest to the others, then flatter, then earlier). When the posts show the file only on grounds under 3:1, those grounds are used: the brand puts its logo there, and a contrast bar does not overrule the brand's own posts. With no ground that counts: rule 2 for the stored file, the neutral of the ground it serves for another file.
5. The templates. The first template is the canvas file over the canvas ground, which by rules 2 to 4 is never a ground chosen blind. The second is the file that serves the ground the first does not cover, over that ground's neutral: the stored file when that is its own ground, else the second file, else the stored file when it shows on both, else the white file when the ground is the dark one. So every ground a file of the set serves has a template, with two templates at most.
6. The file that is stamped. Locate still names the file closest in color to what was drawn. It now chooses among the matched file and the files that serve the ground the matched template covers. A file is therefore never stamped on a ground it was not made for, whatever a color distance says. The other distances are still measured and stored for review.
7. Every stored set and background follows. The rule's version becomes 2. It is part of the step's key, so the lifecycle's next look runs the step once for every client: it writes the background by rule 1 for the rows it owns, makes the set again and settles it. The read of the logo's spot is reused as on 16 Nov (section 4), so no model is called. A job reads only a set of version 2. Until a client's set is settled again its designs start with the one file, as on 15 Nov.

### Why this is the rule

- The reviewer's finding and Ruling 40. The review of the build proposed reading the covered ground from the canvas ground for every stored file. It was declined on two dark designs of this client, which went from pass (0.971 and 0.980) to fail (0.369 and 0.332), because that change replaced the copy's template with the stored file over white. The finding was right about the fault and the ruling was right about that fix. This rule moves the canvas ground to where the file shows and keeps the copy's template: the two dark designs still pass with the copy (0.971 and 0.980 in the replay), and the 18 light designs pass with the stored file (0.833 to 0.979).
- No third template. With the canvas ground right, the first template covers the ground the canvas file serves and the second covers the other. A third search would add up to a third to locate's time for every client.
- No new gate and no pixel guess. The one test stays `logoFound` at 0.75. What changed is which known file is laid over which known color, decided from the files' own parts and from which search found the logo in a post. Rule 6 narrows a choice between known files by a fact of the answer (which template matched).
- General. Nothing names a client or a color. Two clients' settings change today because their files have a part that vanishes on their background, and every other row was tested by the same rule and stays.

### What changes for each client

Measured on the stored logos (the two that changed since 16 Nov read from storage) and the posts on disk. "Weakest" is the lowest contrast any whole exposed part has with the settings background.

| Client | Weakest on its background | Background | Canvas | Templates |
|---|---|---|---|---|
| The client of 16 Nov | 1.01 on #1A1A1A | becomes #FFFFFF | the stored file on #E8E8E8, from its two light posts (was on #1A1A1A) | stored on #E8E8E8, copy on #0B0E1A |
| The orange and purple mark | 1.08 on #FF9D2F | becomes #FFFFFF | the stored file on #FFFFFF (was on #FF9D2F) | stored on #FFFFFF |
| The other 10 lifecycle rows | 3.97 to 21 | unchanged | unchanged | unchanged |
| The 3 rows a person set | 3.58, 6.70, 19.70 | never written | unchanged | unchanged |

The client with one cyan ink keeps its canvas: its one post that names the stored file was found by the near-black copy's search (rule 3), so its settings background stays, where cyan has 8.78:1.

### Data and contract

- `logo_set` gains `inks`, the colors of the stored file's whole exposed parts, and `rule` is 2. No migration: the column is jsonb and `settle_design_logo_set` stores what it is given.
- `canvas.from` keeps its three values. "pole" now also says the stored file rests on its own neutral because it does not show whole on the background.
- `LogoTemplate` gains an optional `names`: the other files that may be named when this template is the match. Absent, every file may be, as before, so a job started before this change is answered as it was. The service's check refuses unknown fields, so the service ships first, as in section 5.
- A job's `input.logos` gains `names` with the two lists. A job without it sends none.

### A design with part of its logo not showing

Asked plainly after the delivered design of 16 Nov: can one still be delivered?

- Through a job that carries a set: no template lies on a ground where a whole part of its file vanishes by choice of an average, and no file is stamped on a ground it does not serve. The delivered design of 16 Nov and its picture as delivered are replay rows, and both fail locate under this rule (0.407 and 0.471 for the design, 0.344 and 0.451 for the delivered picture; the replay record of 17 Nov).
- Through a job with one file (no current set: none settled yet, a set of version 1, or a logo that changed since): the template is the logo over a ground that a design's start reads from the file itself (second pass, below), never from the row's background as it is. So the window between the release and the lifecycle's look at each client does not carry a file on a ground where a whole part of it vanishes. For a row the lifecycle wrote, rule 1 also corrects the stored background by that look.
- What is left, said plainly. A file with a part under 3:1 on both neutrals and on every brand color has no ground it shows whole on. It rests on its own neutral, where 90% of its ink shows best. One client's green has 2.91:1 on white, and its posts show it on #E8E8E8 at 2.37:1. And the one test passes a match of 0.75, so a design that draws a small part faintly can pass, as it could before. Neither is a part chosen away by the app.

### Second pass, 17 Nov 2026 (what the build showed after the rule was written)

Written before the code of these four changes.

1. A ground where a part is no longer a part. Rule 4 says that when the posts show the file only on grounds under 3:1, those grounds are used. It had no floor: a ground on which a whole part has the ground's own color would be used when the brand's found posts have it. "Does not show" is two different facts. A part at 2.37:1 on a light gray shows, and the brand's own posts say so, so the bar does not overrule them. A part within 16 per channel of the ground (the product's own step between two pixels of one part, section 3) is the ground: it is not a part of its own there, and no post's ground makes it one. So a ground counts for the canvas in three tiers, and the first tier that has a post is used: grounds on which the file shows whole (3:1 for every whole part); else grounds on which no whole part has the ground's own color; else none, and the file rests where rule 2 puts it. The post still counts for which file the canvas carries. This is the line between the two statements the owner asked for: a found post is evidence of how the brand shows its logo whatever a contrast bar says, and the canvas never carries a file on a ground where a whole part of it does not show.
2. The file's own ground. By the figure alone, a mid-tone logo with a small near-black part counts as made for dark pictures, where that part does not show. The own ground is now the neutral on which every whole exposed part has 3:1, when exactly one of the two neutrals has that. When both or neither has it, the figure decides as before, light when equal. A file serves the ground it was not made for (`both`) only when every whole part of it has 3:1 there too, not by the figure alone. This changes no set of the 14 stored logos (the replay record of 17 Nov), and changes which file the making rule starts from for none of them.
3. A job with one file starts from the ground the file was made for. `startOption` reads the colors of the stored file's whole parts from its pixels (one decode of the file it already downloads, no call to anything) and gives the template and the canvas the settings background when every whole part shows there, else the neutral of its own ground (rule 2's function, `restGround`). It writes nothing: the settings the person sees and the row stay as they are. This is the case for a client whose set is of version 1 or not yet settled, so the 18 designs of 16 Nov are not repeated in the hours between the release and the lifecycle's look.
4. The proof. The 18 designs that failed on 16 Nov, the 2 designs of the job that ended ready and its delivered picture are rows of the replay, each with an expected result (the replay record of 17 Nov).

How the eight sets made by rule 1 are made again. The rule's version is in the key of the lifecycle's `design_settings` step. The next daily look of each client sees a new key and queues the step once. The step writes the settings background by rule 1 (for a row the lifecycle owns, with the stored read of the logo's spot reused: no model call), asks the picture service for the files again, reads the client's posts again and settles a set of version 2. Nothing is asked of a person. A row a person set keeps its logo, placement and background; only its set is made again.
