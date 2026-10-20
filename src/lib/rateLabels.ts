/**
 * The names of the product's two engagement rates (Lital, 20 Oct 2026). They
 * are never shown under the same bare label:
 *
 * - the client's own performance uses Sprout's figures as Sprout reports
 *   them (clicks included where Sprout counts them), so the team can check
 *   them against Sprout's screen;
 * - a comparison with competitors counts the same actions for every company
 *   (likes, comments and shares; views as the impressions of video), because
 *   competitors have no click data.
 */
export const SPROUT_RATE_LABEL = "Sprout engagement rate";
export const SPROUT_RATE_NOTE = "Sprout's engagements divided by Sprout's impressions, as Sprout reports them";
export const COMPARED_RATE_LABEL = "Engagement rate, compared on likes, comments and shares";
/** For a small tile beside the full label. */
export const COMPARED_RATE_SHORT = "Compared engagement rate";
export const COMPARED_RATE_NOTE = "likes, comments and shares divided by impressions (views on video), the same for every company";
