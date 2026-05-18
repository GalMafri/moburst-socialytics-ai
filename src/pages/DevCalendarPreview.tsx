// Dev-only preview route for iterating on the calendar UI without needing a
// real client + report. Mounted at /dev/calendar in App.tsx behind a
// VITE_DEV_MODE check. Safe to delete after launch.
import { useState } from "react";
import { CalendarFilters, type CalendarFilterState } from "@/components/reports/calendar/CalendarFilters";
import { CalendarKanban } from "@/components/reports/calendar/CalendarKanban";
import { WeeklyHighlights } from "@/components/reports/calendar/WeeklyHighlights";
import { PostPanel } from "@/components/reports/calendar/PostPanel";
import { AppLayout } from "@/components/layout/AppLayout";
import type { ClientContext } from "@/lib/clientContext";

const MOCK_CLIENT_CONTEXT: ClientContext = {
  client_id: "dev-client",
  client_name: "Moburst (dev preview)",
  brand_identity: {
    primary_color: "#b9e045",
    secondary_color: "#1a1d22",
    accent_color: "#ffffff",
    visual_style: "Bold, confident, modern enterprise",
    tone_of_voice: "Direct, expert, energetic",
  } as any,
  design_references: [],
  brand_book_file_path: null,
  brand_book_url: null,
  content_pillars: [
    { name: "Visionary Voices - Thought Leadership", description: "" },
    { name: "Moburst - Service Spotlight & Company Impact", description: "" },
  ],
  brief_text: null,
  brand_notes: null,
  geo: ["US"],
  languages: ["en"],
  timezone: "UTC",
  design_style_synthesis: null,
};

const MOCK_CALENDAR = [
  {
    day: "Monday",
    posts: [
      {
        platform: "LinkedIn",
        format: "Carousel",
        language: "en",
        pillar: "Visionary Voices - Thought Leadership",
        posting_time: "10:00 AM",
        copy: "What changes when AI becomes the first layer of every brand interaction? The teams that figure this out first will redefine what \"earned\" media looks like in the next 18 months.",
        hashtags: ["AI", "MarketingStrategy", "Innovation"],
        visual_direction: "Bold typographic poster",
      },
      {
        platform: "Instagram",
        format: "Reel/Video",
        language: "en",
        pillar: "Innovation in Execution - AI & Technology",
        posting_time: "1:00 PM",
        copy: "AI visibility is no longer a future-facing problem — it's the new ranking signal. Here's what your brand needs to do this quarter.",
        hashtags: ["AI", "SEO", "AEO"],
        visual_direction: "Fast-paced reel with motion graphics",
      },
    ],
  },
  {
    day: "Tuesday",
    posts: [
      {
        platform: "Facebook",
        format: "Video",
        language: "en",
        pillar: "Moburst - Service Spotlight & Company Impact",
        posting_time: "2:00 PM",
        copy: "Many growth challenges do not have technical solutions — they have organizational ones. Here's how we partner with leadership teams to unlock both.",
        visual_direction: "Cinematic talking-head video",
      },
    ],
  },
  {
    day: "Wednesday",
    posts: [
      {
        platform: "LinkedIn",
        format: "Document/PDF",
        language: "en",
        pillar: "Victory Vault - Case Studies & Wins",
        posting_time: "9:00 AM",
        copy: "What does measurable growth look like when strategy and execution actually align? A breakdown of a 6-month engagement that 4x'd qualified pipeline.",
        visual_direction: "Editorial-style document cover",
      },
      {
        platform: "Instagram",
        format: "Carousel",
        language: "en",
        pillar: "Victory Vault - Case Studies & Wins",
        posting_time: "3:00 PM",
        copy: "Behind every strong performance result is a tighter feedback loop between data and creative. Here's the system.",
        visual_direction: "Process diagram carousel",
      },
    ],
  },
  {
    day: "Thursday",
    posts: [
      {
        platform: "LinkedIn",
        format: "Video",
        language: "en",
        pillar: "Inside Moburst - Culture & Careers",
        posting_time: "11:00 AM",
        copy: "What does strategic collaboration actually look like inside a high-performing agency? A short look at how we run cross-functional sprints.",
        visual_direction: "Office b-roll with overlay",
      },
      {
        platform: "Instagram",
        format: "Story",
        language: "en",
        pillar: "Inside Moburst - Culture & Careers",
        posting_time: "4:00 PM",
        copy: "Inside Moburst: from strategy review to launch in 14 days.",
        visual_direction: "Story-format BTS",
      },
    ],
  },
  {
    day: "Friday",
    posts: [
      {
        platform: "LinkedIn",
        format: "Single Image",
        language: "en",
        pillar: "Moburst - Service Spotlight & Company Impact",
        posting_time: "10:00 AM",
        copy: "Influence is changing. Credibility now matters as much as reach — and most brands haven't updated their playbook yet.",
        visual_direction: "Hero image with bold headline",
      },
      {
        platform: "Facebook",
        format: "Carousel",
        language: "en",
        pillar: "Visionary Voices - Thought Leadership",
        posting_time: "1:00 PM",
        copy: "3 strategic shifts marketing leaders are making this quarter — and what's missing from each.",
        visual_direction: "Numbered slide carousel",
      },
    ],
  },
  {
    day: "Saturday",
    posts: [
      {
        platform: "Instagram",
        format: "Single Image",
        language: "en",
        pillar: "Inside Moburst - Culture & Careers",
        posting_time: "11:00 AM",
        copy: "Great marketing is built by teams that know how to disagree well. Here's what that looks like in practice.",
        visual_direction: "Editorial team photo with quote",
      },
    ],
  },
  {
    day: "Sunday",
    posts: [
      {
        platform: "LinkedIn",
        format: "Article",
        language: "en",
        pillar: "Visionary Voices - Thought Leadership",
        posting_time: "12:00 PM",
        copy: "Marketing teams are under pressure to deliver more with less — and the playbook that worked in 2022 isn't going to carry you through 2026.",
        visual_direction: "Article header with bold title",
      },
    ],
  },
];

const MOCK_AI_ANALYSIS = {
  sprout_performance_analysis: {
    pillar_alignment: {
      underrepresented: ["Inside Moburst - Culture & Careers"],
    },
  },
  tiktok_trends_analysis: {
    opportunities_for_client: [
      "Lean into raw founder POV — outperforms polished brand content 3x.",
      "Use creator-style hooks in first 1.5 seconds.",
    ],
  },
  instagram_trends_analysis: {
    opportunities_for_client: [
      "Carousel covers using oversized type are outperforming photo covers.",
    ],
  },
};

// Mock iterations so we can verify the populated card + design panel look
// without a real Supabase round-trip. Friday's LinkedIn Single Image gets a
// finished image; Wednesday's IG Carousel gets multiple variants in a group.
const MOCK_ITERATIONS = [
  {
    id: "it-friday-li-1",
    client_id: "dev-client",
    platform: "LinkedIn",
    post_copy: MOCK_CALENDAR[4].posts[0].copy,
    media_urls: [
      "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&q=80",
    ],
    is_selected: true,
    is_approved: false,
    variant_group_id: "vg-friday-li",
    variant_angle: "Photo-led editorial composition",
    created_at: "2026-05-18T10:00:00Z",
  },
  {
    id: "it-wed-ig-1",
    client_id: "dev-client",
    platform: "Instagram",
    post_copy: MOCK_CALENDAR[2].posts[1].copy,
    media_urls: [
      "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=800&q=80",
    ],
    is_selected: false,
    is_approved: false,
    variant_group_id: "vg-wed-ig",
    variant_angle: "Type-led with brand color blocks",
    created_at: "2026-05-18T11:00:00Z",
  },
  {
    id: "it-wed-ig-2",
    client_id: "dev-client",
    platform: "Instagram",
    post_copy: MOCK_CALENDAR[2].posts[1].copy,
    media_urls: [
      "https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&q=80",
    ],
    is_selected: true,
    is_approved: false,
    variant_group_id: "vg-wed-ig",
    variant_angle: "Photo-led with subtle overlay",
    created_at: "2026-05-18T11:00:30Z",
  },
  {
    id: "it-wed-ig-3",
    client_id: "dev-client",
    platform: "Instagram",
    post_copy: MOCK_CALENDAR[2].posts[1].copy,
    media_urls: [
      "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=80",
    ],
    is_selected: false,
    is_approved: false,
    variant_group_id: "vg-wed-ig",
    variant_angle: "Illustrated abstract",
    created_at: "2026-05-18T11:01:00Z",
  },
];

export default function DevCalendarPreview() {
  const [filters, setFilters] = useState<CalendarFilterState>({
    day: "all",
    platform: "all",
    status: "all",
    language: "all",
  });
  const [activePost, setActivePost] = useState<any | null>(null);

  // Same matching heuristic ContentIdeasTab uses.
  const activePostIterations = activePost
    ? MOCK_ITERATIONS.filter((it) => {
        const mp = (activePost.platform || "").toLowerCase();
        const mc = (activePost.copy || activePost.caption_angle || "")
          .trim()
          .slice(0, 200);
        return (
          (it.platform || "").toLowerCase() === mp &&
          (it.post_copy || "").trim().slice(0, 200) === mc
        );
      })
    : [];

  return (
    <AppLayout title="Calendar UI Preview (DEV)">
      <div className="space-y-4">
        <WeeklyHighlights
          aiAnalysis={MOCK_AI_ANALYSIS}
          sproutMonthSummary="Engagement up 28% MoM, impressions up 41%."
        />
        <CalendarFilters
          filters={filters}
          onChange={setFilters}
          availablePlatforms={["LinkedIn", "Instagram", "Facebook"]}
          availableLanguages={["en"]}
        />
        <CalendarKanban
          contentCalendar={MOCK_CALENDAR}
          postIterations={MOCK_ITERATIONS as any}
          scheduledPosts={[]}
          filters={filters}
          onCardClick={setActivePost}
          onToggleApproved={() => {}}
        />
        <PostPanel
          open={!!activePost}
          onOpenChange={(open) => !open && setActivePost(null)}
          post={activePost}
          postIterations={activePostIterations as any}
          clientContext={MOCK_CLIENT_CONTEXT}
          clientId={undefined}
          reportId={undefined}
          clientTimezone="UTC"
          onToggleSelected={() => {}}
        />
      </div>
    </AppLayout>
  );
}
