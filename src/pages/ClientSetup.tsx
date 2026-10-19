// A client's setup page: a view of what the client lifecycle produced, with
// edit controls (self-serve design, section 1, 19 Oct 2026). The server reads
// the website (brand, logo, location, timezone, language), drafts the brief
// and derives pillars and keywords, matches the Sprout accounts, picks the
// competitors, connects tracking and works out the design settings, all on
// its own. This page shows where each value came from and lets a person
// change any of it. A save sends only the fields the person changed
// (src/lib/clientSetupForm.ts), and the product never overwrites those.
// Nothing here starts paid work on opening, and nothing tells anyone to set
// something up.

import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play, Plus, RefreshCw, Save, X, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loading } from "@/components/ui/loading";
import { PlatformIcon } from "@/lib/platform-config";
import { countryNames, formatDate, languageNames, locationSourceWords, platformName, scheduleLines, timeZoneName } from "@/lib/display";
import { changedColumns, EMPTY_FORM, formFromClient, keywordPhrases, rebaseForm, setByOf, type SetupForm } from "@/lib/clientSetupForm";
import { invokeResendable, sendQuietly, writeResendable } from "@/lib/quietSend";
import { useLifecycleStep } from "@/hooks/useLifecycleStep";
import { type ResolvedRhythmLine, type RhythmSourcesSummary } from "@/lib/postingRhythm";
import { competitiveReportQuality } from "../../supabase/functions/_shared/competitive/reportEvidence";
import { PostingRhythmField } from "@/components/onboarding/PostingRhythmField";
import { StrategyDocUpload } from "@/components/onboarding/StrategyDocUpload";
import { BrandBookUpload } from "@/components/onboarding/BrandBookUpload";
import { DesignReferencesUpload } from "@/components/onboarding/DesignReferencesUpload";
import { AutomaticBrandReferences } from "@/components/onboarding/AutomaticBrandReferences";
import { LogoFileField } from "@/components/onboarding/LogoFileField";
import { DesignSynthesisCard } from "@/components/onboarding/DesignSynthesisCard";
import { DesignSettingsCard } from "@/components/onboarding/DesignSettingsCard";

const PLATFORMS = ["Instagram", "TikTok", "Facebook", "LinkedIn", "Twitter/X", "YouTube"];

const GEOS = [
  { value: "US", label: "United States" },
  { value: "UK", label: "United Kingdom" },
  { value: "EU", label: "Europe" },
  { value: "LATAM", label: "Latin America" },
  { value: "APAC", label: "Asia-Pacific" },
  { value: "MENA", label: "Middle East & North Africa" },
  { value: "IL", label: "Israel" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "BR", label: "Brazil" },
  { value: "JP", label: "Japan" },
  { value: "KR", label: "South Korea" },
  { value: "Global", label: "Global (All Regions)" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish (Español)" },
  { value: "fr", label: "French (Français)" },
  { value: "de", label: "German (Deutsch)" },
  { value: "pt", label: "Portuguese (Português)" },
  { value: "ja", label: "Japanese (日本語)" },
  { value: "ko", label: "Korean (한국어)" },
  { value: "ar", label: "Arabic (العربية)" },
  { value: "zh", label: "Chinese (中文)" },
  { value: "he", label: "Hebrew (עברית)" },
  { value: "it", label: "Italian (Italiano)" },
  { value: "ru", label: "Russian (Русский)" },
  { value: "hi", label: "Hindi (हिन्दी)" },
  { value: "th", label: "Thai (ไทย)" },
];

const TIME_ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Asia/Jerusalem", "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "America/Sao_Paulo", "Asia/Dubai",
  "Australia/Sydney", "Pacific/Auckland", "UTC",
];

const BRAND_VOICE_PRESETS = [
  "Professional / Corporate",
  "Conversational / Friendly",
  "Bold / Punchy",
  "Authoritative / Expert",
  "Playful / Casual",
];

/** How a learned writing preference's type reads to people (brand_voice_learnings.pattern_type). */
const PATTERN_LABELS: Record<string, string> = {
  tone: "Tone", length: "Length", emoji_usage: "Emoji", cta_style: "Calls to action", hashtag_preference: "Hashtags",
  vocabulary: "Wording", structure: "Structure", topics: "Topics", format: "Format", other: "Other",
};

const PILLAR_SOURCES: Record<string, string> = {
  strategy_doc: "the strategy document",
  social_posts: "the client's own posts",
  brief: "the brief",
  site: "the website",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
interface SproutProfile { id: string | number; name?: string; native_name?: string; network_type?: string; network_display?: string; native_link?: string; missing?: boolean }

/** A plain line saying where a value came from; nothing when nobody set it yet. */
function Origin({ children }: { children: React.ReactNode }) {
  return children ? <p className="t-label text-muted-foreground">{children}</p> : null;
}

/** A quiet "Refresh" for one lifecycle step, with a plain line while it runs. */
function StepRefresh({ step, working }: { step: ReturnType<typeof useLifecycleStep>; working: string }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button type="button" variant="outline" size="sm" onClick={() => void step.refresh()} disabled={step.running} className="shrink-0">
        {step.running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
        Refresh
      </Button>
      {step.running && <span role="status" className="t-secondary">{working}</span>}
    </div>
  );
}

export default function ClientSetup() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const setupTab = searchParams.get("tab") || "info";
  const navigate = useNavigate();
  const { canManageClients } = useAuth();
  const queryClient = useQueryClient();
  const isNew = id === "new";
  const clientId = !isNew ? id : undefined;

  const [form, setForm] = useState<SetupForm>(EMPTY_FORM);
  /** The form's values as the database had them when they were loaded: what a save is compared with. */
  const loaded = useRef<SetupForm | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<SproutProfile[] | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPillarName, setNewPillarName] = useState("");
  const [savedVersion, setSavedVersion] = useState(0);
  const [notSaved, setNotSaved] = useState(false);

  const { data: client, refetch: refetchClient } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as Row | null;
    },
    enabled: !!clientId,
  });

  // The lifecycle steps this page offers to run again. When one finishes, the page reads what it wrote.
  const brandStep = useLifecycleStep(clientId, "brand_read", { onDone: () => void refetchClient() });
  const briefStep = useLifecycleStep(clientId, "brief_pillars", { onDone: () => void refetchClient() });

  const { data: assignedProfiles } = useQuery({
    queryKey: ["sprout-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sprout_profiles").select("*").eq("client_id", clientId!).neq("is_active", false);
      if (error) throw error;
      return data as Row[];
    },
    enabled: !!clientId,
  });

  const { data: voiceLearnings } = useQuery({
    queryKey: ["brand-voice-learnings", id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("brand_voice_learnings" as never) as any)
        .select("*").eq("client_id", id).eq("status", "active")
        .order("times_confirmed", { ascending: false }).order("last_confirmed_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Row[];
    },
    enabled: !!clientId,
  });

  // The rhythm the latest week's plan worked out, per platform, and where it came from.
  const { data: planRhythm } = useQuery({
    queryKey: ["plan-rhythm", id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from("calendar_plans" as never) as any)
        .select("rhythm").eq("client_id", id).eq("status", "ready").not("rhythm", "is", null)
        .order("ready_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const rhythm = data?.rhythm as { learned?: ResolvedRhythmLine[]; sources?: RhythmSourcesSummary } | null | undefined;
      return rhythm?.learned ? { resolved: rhythm.learned, sources: rhythm.sources ?? null } : null;
    },
    enabled: !!clientId,
  });

  // The client row as loaded. A row that changes under an open form (the
  // lifecycle wrote something) updates every field the person has not
  // touched, and keeps every field they changed.
  useEffect(() => {
    if (!client) return;
    const next = formFromClient(client);
    const before = loaded.current;
    setForm((f) => (before ? rebaseForm(f, before, next) : next));
    loaded.current = next;
  }, [client]);

  // The Sprout accounts as assigned in the database, the baseline for a save.
  const assignedIds = new Set((assignedProfiles ?? []).map((p) => String(p.sprout_profile_id)));
  const profilesChanged = selectedProfiles !== null && (selectedProfiles.length !== assignedIds.size || selectedProfiles.some((p) => !assignedIds.has(String(p.id))));
  const fieldsChanged = Object.keys(isNew ? changedColumns(EMPTY_FORM, form) : loaded.current ? changedColumns(loaded.current, form) : {}).length > 0;
  const dirty = fieldsChanged || profilesChanged;

  const saveMutation = useMutation({
    mutationFn: async () => {
      setNotSaved(false);
      const changes = isNew ? changedColumns(EMPTY_FORM, form) : changedColumns(loaded.current ?? form, form);
      let savedId = id!;
      if (isNew) {
        // clients.created_by references auth.users(id): the Supabase session's id.
        const { data: { user: supabaseUser } } = await supabase.auth.getUser();
        // The id is made here, so sending the insert again can never make a second client.
        savedId = crypto.randomUUID();
        const { error } = await sendQuietly(() => supabase.from("clients").insert({ id: savedId, ...changes, created_by: supabaseUser?.id ?? null } as never), { again: writeResendable });
        // The client's own id taken: an earlier try of this same insert landed.
        const landed = (error as { code?: string; message?: string } | null)?.code === "23505" && /clients_pkey/.test(String((error as { message?: string }).message));
        if (error && !landed) throw error;
      } else if (Object.keys(changes).length) {
        const { error } = await sendQuietly(() => supabase.from("clients").update(changes as never).eq("id", savedId), { again: writeResendable });
        if (error) throw error;
      }

      // Sprout accounts: only what the person added or removed. A removal is
      // recorded (sprout_profile_removals) so the matcher never adds it back.
      if (!isNew && selectedProfiles && profilesChanged) {
        const chosen = new Set(selectedProfiles.map((p) => String(p.id)));
        const added = selectedProfiles.filter((p) => !assignedIds.has(String(p.id))).map((p) => ({
          client_id: savedId, sprout_profile_id: Number(p.id), profile_name: p.name, native_name: p.native_name,
          network_type: p.network_type, native_link: p.native_link, is_active: true,
        }));
        const removed = [...assignedIds].filter((pid) => !chosen.has(pid)).map(Number).filter(Number.isFinite);
        if (added.length) {
          const { error } = await sendQuietly(() => supabase.from("sprout_profiles").upsert(added as never, { onConflict: "client_id,sprout_profile_id" }), { again: writeResendable });
          if (error) throw error;
        }
        if (removed.length) {
          const { error } = await sendQuietly(() => supabase.from("sprout_profiles").delete().eq("client_id", savedId).in("sprout_profile_id", removed), { again: writeResendable });
          if (error) throw error;
        }
      }

      // References and the brand book are what the design language is learned
      // from: a person changing them asks the lifecycle to learn it again.
      if (!isNew && ("design_references" in changes || "brand_book_file_path" in changes)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await sendQuietly(() => (supabase.rpc as any)("lifecycle_request", { p_client: savedId, p_step: "design_refs" }), { again: writeResendable });
      }
      return { id: savedId };
    },
    onSuccess: (data) => {
      loaded.current = form;
      setSelectedProfiles(null);
      setSavedVersion((v) => v + 1);
      void queryClient.invalidateQueries({ queryKey: ["clients"] });
      void queryClient.invalidateQueries({ queryKey: ["client", isNew ? data.id : id] });
      void queryClient.invalidateQueries({ queryKey: ["sprout-profiles"] });
      toast.success("Saved");
      if (isNew) navigate(`/clients/${data.id}/setup`, { replace: true });
    },
    // The person's changes stay in the form.
    onError: (err) => {
      console.warn("[client setup] not saved yet", err);
      setNotSaved(true);
    },
  });

  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (key: "primary_platforms" | "geo" | "language", value: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const addKeyword = () => {
    const phrases = keywordPhrases(newKeyword, form.social_keywords);
    if (phrases.length) set("social_keywords", [...form.social_keywords, ...phrases]);
    setNewKeyword("");
  };

  const addPillar = () => {
    const name = newPillarName.trim();
    if (name && !form.content_pillars.some((p) => p.name === name)) set("content_pillars", [...form.content_pillars, { name, description: "" }]);
    setNewPillarName("");
  };

  if (!canManageClients) return <Navigate to="/" replace />;

  const fs = client?.field_sources;
  const by = (field: string) => setByOf(fs, field);
  const location = (client?.location ?? null) as { source?: string | null } | null;
  const brandReadOn = formatDate(brandStep.row?.done_at);
  const pillarsOn = formatDate(client?.pillars_derived_at);
  const zones = form.timezone && !TIME_ZONES.includes(form.timezone) ? [form.timezone, ...TIME_ZONES] : TIME_ZONES;
  const geoOptions = [...GEOS, ...form.geo.filter((g) => !GEOS.some((o) => o.value === g)).map((g) => ({ value: g, label: countryNames(g) }))];
  const languageOptions = [...LANGUAGES, ...form.language.filter((l) => !LANGUAGES.some((o) => o.value === l)).map((l) => ({ value: l, label: languageNames(l) }))];

  return (
    <AppLayout
      title={isNew ? "New Client" : `${form.name || "Client"} Setup`}
      description="Client details, social profiles, brand assets, competitors and report schedules."
      width="max-w-5xl"
      actions={
        <>
          {!isNew && (
            <Button onClick={() => navigate(`/clients/${id}/analyze`)}>
              <Play className="h-4 w-4 mr-2" /> Run Report
            </Button>
          )}
          <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name.trim() || (!isNew && !dirty)}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </>
      }
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {notSaved && <p role="status" className="t-secondary">Your changes are kept here and are not saved yet.</p>}
        {isNew && <p className="t-secondary">A name and a website are all a new client needs. The rest is read from the website once the client is created, and every value can be changed here.</p>}

        <AutomaticBrandReferences
          clientId={clientId && client ? clientId : undefined}
          savedVersion={savedVersion}
          // A style learned again: the design language card reads it from the client row.
          onReady={() => void refetchClient()}
        />
        <Tabs defaultValue={setupTab}>
          {/* On mobile (<sm), tabs scroll horizontally to keep labels readable. */}
          <TabsList className="w-full overflow-x-auto sm:grid sm:grid-cols-7 flex sm:flex-none gap-1 sm:gap-0 justify-start">
            <TabsTrigger value="info" className="flex-shrink-0">Client info</TabsTrigger>
            <TabsTrigger value="sprout" className="flex-shrink-0">Sprout Social</TabsTrigger>
            <TabsTrigger value="strategy" className="flex-shrink-0">Content strategy</TabsTrigger>
            <TabsTrigger value="competitors" className="flex-shrink-0">Competitors</TabsTrigger>
            <TabsTrigger value="brief" className="flex-shrink-0">Brief</TabsTrigger>
            <TabsTrigger value="schedule" className="flex-shrink-0">Schedule</TabsTrigger>
            {!isNew && <TabsTrigger value="designs" className="flex-shrink-0">Designs</TabsTrigger>}
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Basic information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="client-name">Client Name *</Label>
                  <Input id="client-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g., Acme Corp" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-website">Website URL</Label>
                  <div className="flex gap-2 items-start flex-wrap sm:flex-nowrap">
                    <Input id="client-website" value={form.website_url} onChange={(e) => set("website_url", e.target.value)} placeholder="https://example.com" />
                    {clientId && <StepRefresh step={brandStep} working="Reading the website" />}
                  </div>
                  <Origin>
                    {clientId && brandReadOn
                      ? `The brand, logo, location, time zone and language are read from the website, last on ${brandReadOn}, and again whenever it changes.`
                      : "The brand, logo, location, time zone and language are read from the website."}
                  </Origin>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-timezone">Client Timezone</Label>
                  <Select value={form.timezone || undefined} onValueChange={(value) => set("timezone", value)}>
                    <SelectTrigger id="client-timezone" className="w-full">
                      <SelectValue placeholder="Worked out from the website" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((z) => <SelectItem key={z} value={z}>{timeZoneName(z)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Origin>
                    {by("timezone") === "person"
                      ? "Set by your team. The product keeps it as it is."
                      : by("timezone") === "lifecycle" && locationSourceWords(location?.source)
                        ? `Worked out from ${locationSourceWords(location?.source)}. You can change it here.`
                        : "Used for posting times on the calendar."}
                  </Origin>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-media-backend">Image &amp; video generation</Label>
                  <Select value={form.media_backend} onValueChange={(value) => set("media_backend", value)}>
                    <SelectTrigger id="client-media-backend" className="w-full">
                      <SelectValue placeholder="Select a generator" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Standard (Gemini + Veo)</SelectItem>
                      <SelectItem value="higgsfield">Higgsfield (sharper type, team credits)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="t-secondary">Higgsfield renders headline type far more cleanly and spends the team's shared Higgsfield credits: roughly 2 per design.</p>
                </div>

                {form.brand_identity && (
                  <div className="space-y-4 rounded-lg border p-4 bg-[rgba(255,255,255,0.02)]">
                    <div className="space-y-1">
                      <Label className="t-body font-semibold">Brand identity</Label>
                      <Origin>
                        {by("brand_identity") === "person"
                          ? "Set by your team. The product keeps it as it is."
                          : by("brand_identity") === "lifecycle"
                            ? `Read from the website${brandReadOn ? ` on ${brandReadOn}` : ""}. You can change any of it here.`
                            : ""}
                      </Origin>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {([["primary_color", "Primary color"], ["secondary_color", "Secondary color"], ["accent_color", "Accent color"]] as const).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <Label className="t-label">{label}</Label>
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded border shrink-0" style={{ backgroundColor: form.brand_identity?.[key] || "#ccc" }} />
                            <Input value={form.brand_identity?.[key] || ""} onChange={(e) => set("brand_identity", { ...form.brand_identity, [key]: e.target.value })} placeholder="#000000" className="h-8 t-label font-mono" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {([["font_family", "Font Family", "Inter, sans-serif"], ["visual_style", "Visual Style", "Modern, clean, minimalist"], ["tone_of_voice", "Tone of Voice", "Warm, approachable, health-conscious"], ["background_style", "Background Style", "Soft gradients, lifestyle photography"]] as const).map(([key, label, placeholder]) => (
                        <div key={key} className="space-y-1">
                          <Label htmlFor={`brand-${key}`} className="t-label">{label}</Label>
                          <Input id={`brand-${key}`} value={form.brand_identity?.[key] || ""} onChange={(e) => set("brand_identity", { ...form.brand_identity, [key]: e.target.value })} placeholder={placeholder} className="h-8 text-sm" />
                        </div>
                      ))}
                    </div>
                    {([["design_elements", "Design Elements", "Rounded shapes, lifestyle photography, organic textures"], ["logo_description", "Logo Description", "Rounded wordmark in green with leaf icon"]] as const).map(([key, label, placeholder]) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`brand-${key}`} className="t-label">{label}</Label>
                        <Input id={`brand-${key}`} value={form.brand_identity?.[key] || ""} onChange={(e) => set("brand_identity", { ...form.brand_identity, [key]: e.target.value })} placeholder={placeholder} className="h-8 text-sm" />
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Primary Platforms</Label>
                  <Origin>
                    {by("primary_platforms") === "person"
                      ? "Set by your team. These platforms get content recommendations and calendar posts."
                      : by("primary_platforms") === "lifecycle"
                        ? "Taken from the client's Sprout accounts. These platforms get content recommendations and calendar posts."
                        : "These platforms get content recommendations and calendar posts."}
                  </Origin>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map((p) => {
                      const active = form.primary_platforms.includes(p);
                      return (
                        <button key={p} type="button" onClick={() => toggleIn("primary_platforms", p)} aria-pressed={active}
                          className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                          <Badge variant={active ? "default" : "outline"} className="cursor-pointer t-body py-1.5 px-3">{p}</Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Geographic Focus (select multiple)</Label>
                  <Origin>{by("geo") === "lifecycle" ? "Read from the website. You can change it here." : ""}</Origin>
                  <div className="flex flex-wrap gap-2">
                    {geoOptions.map((g) => {
                      const active = form.geo.includes(g.value);
                      return (
                        <button key={g.value} type="button" onClick={() => toggleIn("geo", g.value)} aria-pressed={active}
                          className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                          <Badge variant={active ? "default" : "outline"} className="cursor-pointer t-body py-1.5 px-3">{g.label}</Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Content Languages (select multiple)</Label>
                  <div className="flex flex-wrap gap-2">
                    {languageOptions.map((l) => {
                      const active = form.language.includes(l.value);
                      return (
                        <button key={l.value} type="button" onClick={() => toggleIn("language", l.value)} aria-pressed={active}
                          className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                          <Badge variant={active ? "default" : "outline"} className="cursor-pointer t-body py-1.5 px-3">{l.label}</Badge>
                        </button>
                      );
                    })}
                  </div>
                  <p className="t-secondary">
                    {by("language") === "lifecycle" ? "Read from the website. " : ""}AI-generated copy targets these languages, and trends include posts in any of them.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sprout" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Sprout Social Profiles</CardTitle>
                <CardDescription>
                  Matched automatically from Sprout's brand names and the profiles the client's website links to, and looked at again every day. Add or remove any here; a profile you remove stays removed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {clientId ? (
                  <SproutProfileSelector
                    assigned={assignedProfiles ?? null}
                    selected={selectedProfiles}
                    onChange={setSelectedProfiles}
                  />
                ) : (
                  <p className="t-secondary">The client's accounts are matched once it is created.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="strategy" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Content strategy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <StrategyDocUpload
                  clientId={clientId}
                  clientName={form.name}
                  filePath={form.strategy_doc_file_path}
                  onFilePathChange={(path) => set("strategy_doc_file_path", path)}
                />
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 min-w-0">
                      <Label>Content pillars</Label>
                      <Origin>
                        {by("content_pillars") === "person"
                          ? "Set by your team. The product keeps them as they are."
                          : by("content_pillars") === "lifecycle"
                            ? `Read from ${PILLAR_SOURCES[String(client?.pillars_source ?? "")] ?? "the brief and the website"}${pillarsOn ? ` on ${pillarsOn}` : ""}, and again when the brief or strategy document changes. You can change any of them here.`
                            : "Read from the strategy document, the brief and the website."}
                      </Origin>
                    </div>
                    {clientId && <StepRefresh step={briefStep} working="Reading the brief and the website" />}
                  </div>
                  <div className="space-y-3">
                    {form.content_pillars.map((pillar, index) => (
                      <div key={index} className="p-3 rounded-md border bg-card space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium t-body">{pillar.name}</span>
                          <Button variant="ghost" size="sm" onClick={() => set("content_pillars", form.content_pillars.filter((_, i) => i !== index))} aria-label={`Remove pillar ${pillar.name}`}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          value={pillar.description}
                          onChange={(e) => set("content_pillars", form.content_pillars.map((p, i) => (i === index ? { ...p, description: e.target.value } : p)))}
                          placeholder={`What "${pillar.name}" content looks like: topics, tone, examples...`}
                          rows={2}
                          className="t-body"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input value={newPillarName} onChange={(e) => setNewPillarName(e.target.value)} placeholder="Add a content pillar" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPillar())} />
                    <Button variant="outline" size="sm" onClick={addPillar} aria-label="Add content pillar">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Social Keywords</Label>
                  <p className="t-secondary">
                    Phrases used for TikTok and Instagram trend search, such as "AI content strategy" or "performance marketing tips".
                    {by("social_keywords") === "lifecycle" ? " Read with the pillars; you can change any of them here." : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {form.social_keywords.map((k) => (
                      <Badge key={k} variant="outline" className="gap-1.5 pr-1 t-body py-1">
                        {k}
                        <button type="button" aria-label={`Remove keyword ${k}`} onClick={() => set("social_keywords", form.social_keywords.filter((x) => x !== k))}
                          className="rounded-full p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Add keyword phrases (press Enter)" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())} />
                    <Button variant="outline" size="sm" onClick={addKeyword} aria-label="Add keyword phrase">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                <PostingRhythmField
                  platforms={form.primary_platforms}
                  value={form.posting_rhythm}
                  resolved={planRhythm?.resolved ?? null}
                  sources={planRhythm?.sources ?? null}
                  onChange={(posting_rhythm) => set("posting_rhythm", posting_rhythm)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competitors" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Competitive context</CardTitle>
                <CardDescription>
                  The three closest competitors with a website are chosen automatically. Notes from the account team are weighed heavily when they are.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="competitor-notes">Competitor notes</Label>
                  <Textarea id="competitor-notes" rows={5}
                    placeholder={'e.g. "Direct: Brand A, Brand B (same price point). Aspirational: Brand C, do not include. Regional player: Brand D."'}
                    value={form.competitor_seed_notes}
                    onChange={(e) => set("competitor_seed_notes", e.target.value)}
                  />
                </div>
                {clientId && (
                  <Button variant="outline" onClick={() => navigate(`/clients/${id}/competitive`)}>
                    Open competitors
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brief" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Client brief</CardTitle>
                <CardDescription>Brand voice, target audience, campaign objectives, and content restrictions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Brand Voice Preset</Label>
                  <p className="t-secondary">The tone that best matches this client's brand voice.</p>
                  <div className="flex flex-wrap gap-2">
                    {BRAND_VOICE_PRESETS.map((preset) => (
                      <button key={preset} type="button" aria-pressed={form.brand_voice_preset === preset} onClick={() => set("brand_voice_preset", form.brand_voice_preset === preset ? "" : preset)}
                        className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        <Badge variant={form.brand_voice_preset === preset ? "default" : "outline"} className="cursor-pointer">{preset}</Badge>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="brand-notes">Brand Notes</Label>
                  <Textarea id="brand-notes" value={form.brand_notes} onChange={(e) => set("brand_notes", e.target.value)} placeholder="Brand voice, positioning, key messaging..." rows={3} />
                </div>
                <LogoFileField clientId={clientId} clientName={form.name} logoUrl={form.logo_url} onChange={(url) => set("logo_url", url)} />
                <Origin>{by("logo_url") === "lifecycle" ? "The logo on file was taken from the client's website." : ""}</Origin>
                <details className="space-y-3"><summary className="cursor-pointer t-secondary">Optional brand documents and additional references</summary>
                  <BrandBookUpload
                    clientId={clientId}
                    clientName={form.name}
                    brandBookUrl={form.brand_book_url}
                    brandBookFilePath={form.brand_book_file_path}
                    onBrandBookUrlChange={(url) => set("brand_book_url", url)}
                    onBrandBookFilePathChange={(path) => set("brand_book_file_path", path)}
                    onBrandIdentityExtracted={(identity) => setForm((f) => ({ ...f, brand_identity: { ...f.brand_identity, ...identity } }))}
                  />
                  <DesignReferencesUpload
                    clientId={clientId}
                    clientName={form.name}
                    designReferences={form.design_references}
                    onDesignReferencesChange={(refs) => set("design_references", refs)}
                  />
                  <DesignSynthesisCard existingSynthesis={client?.design_style_synthesis ?? null} />
                </details>
                <div className="space-y-2">
                  <Label htmlFor="brief-text">Brief Text</Label>
                  <Origin>
                    {by("brief_text") === "lifecycle"
                      ? `Written by the product from ${client?.strategy_doc_file_path ? "the strategy document" : "the website"}. You can rewrite it; the product never replaces your version.`
                      : ""}
                  </Origin>
                  <Textarea id="brief-text" value={form.brief_text} onChange={(e) => set("brief_text", e.target.value)} rows={10}
                    placeholder={`Brand Voice: Professional yet approachable\nTarget Audience: B2B SaaS decision-makers\nCampaign Objectives: Increase brand awareness and thought leadership\nContent Restrictions: No competitor mentions\nCompetitive Positioning: Market leader in AI-powered analytics`}
                  />
                </div>
              </CardContent>
            </Card>

            {voiceLearnings && voiceLearnings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="t-h3">Learned writing preferences</CardTitle>
                  <CardDescription>
                    Learned from copy edits and "Revise this week" notes. Every post written for this client follows these first, then the voice of its own published posts.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {voiceLearnings.map((learning) => (
                      <div key={learning.id} className="flex items-start justify-between gap-3 p-3 rounded-md border bg-card">
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="t-label">{PATTERN_LABELS[learning.pattern_type] ?? "Other"}</Badge>
                            <span className="t-secondary">
                              {learning.times_confirmed > 1 ? `Confirmed ${learning.times_confirmed} times` : "Seen once"}
                              {" · "}
                              {learning.source === "revise_note" ? "From a revise note" : "From a copy edit"}
                            </span>
                          </div>
                          <p className="t-body">{learning.pattern_description}</p>
                        </div>
                        <Button variant="ghost" size="sm" className="shrink-0 h-8 px-2" aria-label="Remove brand voice learning"
                          onClick={async () => {
                            await sendQuietly(() => supabase.from("brand_voice_learnings").delete().eq("id", learning.id), { again: writeResendable });
                            // The list shows what the database has.
                            void queryClient.invalidateQueries({ queryKey: ["brand-voice-learnings", id] });
                          }}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {clientId && (
            <TabsContent value="designs" className="space-y-4 mt-4">
              <DesignSettingsCard clientId={clientId} />
            </TabsContent>
          )}

          <TabsContent value="schedule" className="space-y-4 mt-4">
            {clientId ? (
              <ReportScheduleManager clientId={clientId} timeZone={client?.timezone || undefined} />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Both monthly reports are scheduled for the 7th of each month when the client is created.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

/** Next 7th of the month at 07:15 UTC, which is when the daily scheduler fires. */
function nextSeventh(): string {
  const now = new Date();
  let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 7, 7, 15, 0));
  if (next <= now) next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 7, 7, 15, 0));
  return next.toISOString();
}

function ReportScheduleManager({ clientId, timeZone }: { clientId: string; timeZone?: string }) {
  const queryClient = useQueryClient();
  const KINDS = [
    { kind: "social", noun: "monthly" as const, label: "Monthly social report", description: "Sprout performance and trends for the previous calendar month. Its findings feed the weekly calendar plans." },
    { kind: "competitive", noun: "competitive" as const, label: "Monthly competitive analysis", description: "The client and its three competitors in RivalIQ for the previous calendar month. It runs first, so the social report can use it." },
  ] as const;

  const { data, isLoading } = useQuery({
    queryKey: ["report-schedules", clientId],
    queryFn: async () => {
      const [schedules, social, competitive] = await Promise.all([
        supabase.from("report_schedules").select("*").eq("client_id", clientId),
        supabase.from("reports").select("date_range_start, date_range_end, created_at").eq("client_id", clientId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("competitive_reports").select("date_range_start, date_range_end, created_at, report_data").eq("client_id", clientId).eq("status", "complete").order("created_at", { ascending: false }).limit(6),
      ]);
      if (schedules.error) throw schedules.error;
      // The latest analysis that passed its checks: a held one is not the last report anyone got.
      const ready = (competitive.data || []).find((r) => competitiveReportQuality(r.report_data).ready) ?? null;
      return { schedules: (schedules.data || []) as Row[], latest: { social: social.data ?? null, competitive: ready } as Record<string, Row | null> };
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ kind, active }: { kind: string; active: boolean }) => {
      const existing = (data?.schedules || []).find((s) => (s.report_kind || "social") === kind);
      const payload = {
        client_id: clientId, report_kind: kind, frequency: "monthly", run_day_of_month: 7, range_mode: "previous_month",
        is_active: active, next_run_at: active ? nextSeventh() : null,
      };
      const { error } = existing
        ? await sendQuietly(() => supabase.from("report_schedules").update(payload).eq("id", existing.id), { again: writeResendable })
        : await sendQuietly(() => supabase.from("report_schedules").upsert(payload, { onConflict: "client_id,report_kind" }), { again: writeResendable });
      if (error) throw error;
    },
    // The switch shows what the schedule is in the database.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["report-schedules", clientId] }),
  });

  if (isLoading) return <Loading label="Loading schedules" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="t-h3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4" /> Monthly schedules
        </CardTitle>
        <CardDescription>Both reports run on the 7th of each month and cover the previous calendar month.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {KINDS.map(({ kind, noun, label, description }) => {
          const row = (data?.schedules || []).find((s) => (s.report_kind || "social") === kind);
          const active = !!row?.is_active;
          const latest = data?.latest[kind];
          const lines = scheduleLines({
            kind: noun, active, nextRunAt: row?.next_run_at,
            latest: latest ? { start: latest.date_range_start, end: latest.date_range_end, ranAt: latest.created_at } : null,
            timeZone,
          });
          return (
            <div key={kind} className="flex items-start justify-between gap-4 glass-inner p-4">
              <div className="space-y-1">
                <Label>{label}</Label>
                <p className="t-secondary">{description}</p>
                {lines.map((line) => <p key={line} className="t-secondary">{line}</p>)}
              </div>
              <Switch checked={active} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate({ kind, active: v })} aria-label={`${label} on or off`} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * The client's Sprout accounts. The lifecycle assigns them (the accounts
 * step); this shows them and lets a person add or remove any. Sprout's list
 * of every profile on the agency account is read quietly, and asked for again
 * a minute later when it does not come back; the assigned accounts show
 * either way.
 */
function SproutProfileSelector({ assigned, selected, onChange }: {
  assigned: Row[] | null;
  /** The person's selection, or null while it equals what is assigned. */
  selected: SproutProfile[] | null;
  onChange: (profiles: SproutProfile[] | null) => void;
}) {
  const [allProfiles, setAllProfiles] = useState<SproutProfile[] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchProfiles = useCallback(async () => {
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("sprout-profiles", { body: {} }), { again: (e) => invokeResendable(e, { idempotent: true }) });
    if (!error && Array.isArray(data?.profiles)) setAllProfiles(data.profiles);
    return !error;
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const load = async () => { if (!(await fetchProfiles())) timer = window.setTimeout(load, 60_000); };
    void load();
    return () => window.clearTimeout(timer);
  }, [fetchProfiles]);

  // What is assigned, as Sprout lists it when it does; an assigned profile Sprout no longer lists is kept.
  const fromAssigned: SproutProfile[] = (assigned ?? []).map((a) => {
    const listed = (allProfiles ?? []).find((p) => String(p.id) === String(a.sprout_profile_id));
    return listed ?? { id: a.sprout_profile_id, name: a.profile_name, native_name: a.native_name, network_type: a.network_type, native_link: a.native_link, missing: allProfiles !== null };
  });
  const current = selected ?? fromAssigned;
  const isSelected = (p: SproutProfile) => current.some((s) => String(s.id) === String(p.id));
  const toggleProfile = (p: SproutProfile) => onChange(isSelected(p) ? current.filter((s) => String(s.id) !== String(p.id)) : [...current, p]);

  const filtered = (allProfiles ?? [])
    .filter((p) => !searchTerm || (p.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || (p.native_name || "").toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div className="space-y-4">
      {current.length > 0 ? (
        <div className="glass-inner p-3 space-y-2">
          <p className="t-subhead">Connected</p>
          <ul className="space-y-1.5">
            {current.map((profile) => (
              <li key={String(profile.id)} className="flex items-center gap-2 min-w-0">
                <PlatformIcon platform={profile.network_type || profile.network_display} className="h-4 w-4 shrink-0" />
                <span className="t-body truncate">{profile.name}</span>
                {profile.native_name && <span className="t-label text-muted-foreground truncate">@{profile.native_name}</span>}
                {profile.missing && <span className="t-label text-muted-foreground shrink-0">No longer listed in Sprout</span>}
                {profile.native_link && (
                  <a href={profile.native_link} target="_blank" rel="noopener noreferrer" className="t-label text-primary ml-auto shrink-0">Open</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="t-secondary">No accounts are matched to this client yet. Accounts added to Moburst's Sprout account are picked up within a day.</p>
      )}

      {allProfiles === null ? (
        <div className="flex items-center gap-2 t-secondary py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Sprout Social profiles...
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="t-secondary">{current.length} of {allProfiles.length} profiles in Sprout are assigned to this client</p>
            <Button variant="ghost" size="sm" onClick={() => void fetchProfiles()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
          <Input placeholder="Search by name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
            {filtered.map((profile) => {
              const on = isSelected(profile);
              return (
                <div key={String(profile.id)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${on ? "bg-primary/10 border-primary/30" : "bg-card hover:bg-accent/30"}`}
                  onClick={() => toggleProfile(profile)}>
                  <Checkbox checked={on} onCheckedChange={() => toggleProfile(profile)} aria-label={`Assign ${profile.name}`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium t-body">{profile.name}</span>
                    {profile.native_name && <span className="text-muted-foreground t-label ml-1.5">@{profile.native_name}</span>}
                  </div>
                  <Badge variant={on ? "default" : "secondary"} className="t-label shrink-0 gap-1">
                    <PlatformIcon platform={profile.network_type || profile.network_display} className="h-3 w-3" /> {platformName(profile.network_type || profile.network_display)}
                  </Badge>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
