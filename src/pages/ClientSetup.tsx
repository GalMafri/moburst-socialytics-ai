import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Save, Plus, X, RefreshCw, Loader2, Play, Info, CalendarClock, Globe } from "lucide-react";
import { Switch } from "@/components/ui/switch";

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

const BRAND_VOICE_PRESETS = [
  "Professional / Corporate",
  "Conversational / Friendly",
  "Bold / Punchy",
  "Authoritative / Expert",
  "Playful / Casual",
];

interface ContentPillar {
  name: string;
  description: string;
}

const DEFAULT_PILLARS: ContentPillar[] = [
  { name: "Thought Leadership", description: "" },
  { name: "Product Education", description: "" },
  { name: "Client Wins", description: "" },
  { name: "Industry Trends", description: "" },
  { name: "Team Culture", description: "" },
];

export default function ClientSetup() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isNew = id === "new";

  const [form, setForm] = useState({
    name: "",
    website_url: "",
    social_keywords: [] as string[],
    content_pillars: [...DEFAULT_PILLARS] as ContentPillar[],
    primary_platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn"],
    geo: ["US"] as string[],
    language: ["en"] as string[],
    brand_notes: "",
    brand_voice_preset: "",
    brand_book_text: "",
    brand_identity: null as any,
    brief_text: "",
    brief_file_id: "",
  });
  const [selectedSproutProfiles, setSelectedSproutProfiles] = useState<any[]>([]);
  const [researchingBrand, setResearchingBrand] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPillarName, setNewPillarName] = useState("");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !isNew && !!id,
  });

  useEffect(() => {
    if (client) {
      // Parse pillars - handle both old string[] format and new object[] format
      let pillars: ContentPillar[] = [...DEFAULT_PILLARS];
      if (client.content_pillars) {
        const raw = client.content_pillars as any;
        if (Array.isArray(raw)) {
          pillars = raw.map((p: any) =>
            typeof p === "string"
              ? { name: p, description: "" }
              : { name: p.name || "", description: p.description || "" },
          );
        }
      }
      // Parse [VOICE:preset] prefix from brand_notes
      let brandNotes = client.brand_notes || "";
      let voicePreset = "";
      const voiceMatch = brandNotes.match(/^\[VOICE:(.+?)]\n?/);
      if (voiceMatch) {
        voicePreset = voiceMatch[1];
        brandNotes = brandNotes.slice(voiceMatch[0].length);
      }

      // Parse comma-separated geo/language to arrays
      const geoArr = client.geo
        ? client.geo
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : ["US"];
      const langArr = client.language
        ? client.language
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean)
        : ["en"];

      setForm({
        name: client.name || "",
        website_url: client.website_url || "",
        social_keywords: client.social_keywords || [],
        content_pillars: pillars,
        primary_platforms: client.primary_platforms || ["Instagram", "TikTok", "Facebook", "LinkedIn"],
        geo: geoArr,
        language: langArr,
        brand_notes: brandNotes,
        brand_voice_preset: voicePreset,
        brand_book_text: client.brand_book_text || "",
        brand_identity: client.brand_identity || null,
        brief_text: client.brief_text || "",
        brief_file_id: client.brief_file_id || "",
      });
    }
  }, [client]);

  const toggleGeo = (value: string) => {
    setForm((f) => ({
      ...f,
      geo: f.geo.includes(value) ? f.geo.filter((g) => g !== value) : [...f.geo, value],
    }));
  };

  const toggleLanguage = (value: string) => {
    setForm((f) => ({
      ...f,
      language: f.language.includes(value) ? f.language.filter((l) => l !== value) : [...f.language, value],
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Serialize brand voice preset into brand_notes
      const serializedBrandNotes = form.brand_voice_preset
        ? `[VOICE:${form.brand_voice_preset}]\n${form.brand_notes}`
        : form.brand_notes;
      const { brand_voice_preset, ...formWithoutPreset } = form;
      const payload = {
        ...formWithoutPreset,
        brand_notes: serializedBrandNotes,
        geo: form.geo.join(","),
        language: form.language.join(","),
        sprout_customer_id: "1676448",
        content_pillars: form.content_pillars as any,
      };
      let clientId: string;
      if (isNew) {
        const { data, error } = await supabase
          .from("clients")
          .insert({ ...payload, created_by: user!.id } as any)
          .select()
          .single();
        if (error) throw error;
        clientId = data.id;
      } else {
        const { error } = await supabase
          .from("clients")
          .update(payload as any)
          .eq("id", id!);
        if (error) throw error;
        clientId = id!;
      }

      // Save selected Sprout profiles
      if (selectedSproutProfiles.length > 0) {
        // Remove old profiles
        await supabase.from("sprout_profiles").delete().eq("client_id", clientId);
        // Insert selected
        const inserts = selectedSproutProfiles.map((p) => ({
          client_id: clientId,
          sprout_profile_id: p.id,
          profile_name: p.name,
          native_name: p.native_name,
          network_type: p.network_type,
          native_link: p.native_link,
        }));
        const { error: profileError } = await supabase.from("sprout_profiles").insert(inserts);
        if (profileError) throw profileError;
      }

      return { id: clientId };
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", isNew ? data.id : id] });
      queryClient.invalidateQueries({ queryKey: ["sprout-profiles"] });
      toast({ title: "Saved", description: "Client configuration saved successfully." });
      if (isNew) navigate(`/clients/${data.id}/setup`, { replace: true });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const togglePlatform = (platform: string) => {
    setForm((f) => ({
      ...f,
      primary_platforms: f.primary_platforms.includes(platform)
        ? f.primary_platforms.filter((p) => p !== platform)
        : [...f.primary_platforms, platform],
    }));
  };

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (!trimmed) return;

    // Validate: warn about commas
    if (trimmed.includes(",")) {
      toast({
        title: "Use separate entries instead of commas",
        description:
          'Each keyword phrase should be added individually. e.g., add "AI content strategy" and "performance marketing tips" as two separate keywords.',
        variant: "destructive",
      });
      return;
    }

    if (!form.social_keywords.includes(trimmed)) {
      setForm((f) => ({ ...f, social_keywords: [...f.social_keywords, trimmed] }));
      setNewKeyword("");
    }
  };

  const addPillar = () => {
    if (newPillarName.trim() && !form.content_pillars.some((p) => p.name === newPillarName.trim())) {
      setForm((f) => ({
        ...f,
        content_pillars: [...f.content_pillars, { name: newPillarName.trim(), description: "" }],
      }));
      setNewPillarName("");
    }
  };

  const updatePillarDescription = (index: number, description: string) => {
    setForm((f) => ({
      ...f,
      content_pillars: f.content_pillars.map((p, i) => (i === index ? { ...p, description } : p)),
    }));
  };

  const removePillar = (index: number) => {
    setForm((f) => ({ ...f, content_pillars: f.content_pillars.filter((_, i) => i !== index) }));
  };

  return (
    <AppLayout title={isNew ? "New Client" : `${form.name || "Client"} Setup`}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{isNew ? "Create New Client" : "Client Configuration"}</h2>
            <p className="text-sm text-muted-foreground">Configure client details and social media settings</p>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button onClick={() => navigate(`/clients/${id}/analyze`)}>
                <Play className="h-4 w-4 mr-2" /> Run Report
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </div>
        </div>

        <Tabs defaultValue="info">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="info">Client Info</TabsTrigger>
            <TabsTrigger value="sprout">Sprout Social</TabsTrigger>
            <TabsTrigger value="strategy">Content Strategy</TabsTrigger>
            <TabsTrigger value="brief">Brief</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Client Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., Acme Corp"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Website URL</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.website_url}
                      onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                      placeholder="https://example.com"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        if (!form.website_url) {
                          toast({ title: "Enter a website URL first", variant: "destructive" });
                          return;
                        }
                        setResearchingBrand(true);
                        try {
                          const { data, error } = await supabase.functions.invoke("research-brand-identity", {
                            body: { website_url: form.website_url, client_name: form.name },
                          });
                          if (error) throw error;
                          if (data?.error) throw new Error(data.error);
                          setForm((f) => ({ ...f, brand_identity: data.brand_identity }));
                          toast({
                            title: "Brand identity extracted",
                            description: "Review and edit the results below.",
                          });
                        } catch (err: any) {
                          toast({ title: "Brand research failed", description: err.message, variant: "destructive" });
                        } finally {
                          setResearchingBrand(false);
                        }
                      }}
                      disabled={researchingBrand || !form.website_url}
                      className="shrink-0"
                    >
                      {researchingBrand ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Globe className="h-4 w-4 mr-1" />
                      )}
                      Research Brand
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter the client's website to automatically extract brand colors and visual style.
                  </p>
                </div>

                {form.brand_identity && (
                  <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                    <Label className="text-sm font-semibold">Brand Identity</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {(["primary_color", "secondary_color", "accent_color"] as const).map((key) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-xs capitalize">{key.replace(/_/g, " ")}</Label>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-8 w-8 rounded border shrink-0"
                              style={{ backgroundColor: form.brand_identity?.[key] || "#ccc" }}
                            />
                            <Input
                              value={form.brand_identity?.[key] || ""}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  brand_identity: { ...f.brand_identity, [key]: e.target.value },
                                }))
                              }
                              placeholder="#000000"
                              className="h-8 text-xs font-mono"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Font Family</Label>
                        <Input
                          value={form.brand_identity?.font_family || ""}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              brand_identity: { ...f.brand_identity, font_family: e.target.value },
                            }))
                          }
                          placeholder="Inter, sans-serif"
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Visual Style</Label>
                        <Input
                          value={form.brand_identity?.visual_style || ""}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              brand_identity: { ...f.brand_identity, visual_style: e.target.value },
                            }))
                          }
                          placeholder="Modern, clean, minimalist"
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Primary Platforms</Label>
                  <p className="text-xs text-muted-foreground">
                    Select ALL platforms the client is active on or wants to grow on. This determines which platforms
                    receive content recommendations and calendar posts.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map((p) => (
                      <Badge
                        key={p}
                        variant={form.primary_platforms.includes(p) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => togglePlatform(p)}
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Geographic Focus (select multiple)</Label>
                  <div className="flex flex-wrap gap-2">
                    {GEOS.map((g) => (
                      <Badge
                        key={g.value}
                        variant={form.geo.includes(g.value) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleGeo(g.value)}
                      >
                        {g.label}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Content Languages (select multiple)</Label>
                  <div className="flex flex-wrap gap-2">
                    {LANGUAGES.map((l) => (
                      <Badge
                        key={l.value}
                        variant={form.language.includes(l.value) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleLanguage(l.value)}
                      >
                        {l.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    AI-generated copy will target these languages. Trends will include posts matching any selected
                    language.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sprout" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sprout Social Profiles</CardTitle>
                <CardDescription>Select the Sprout Social profiles that belong to this client</CardDescription>
              </CardHeader>
              <CardContent>
                <SproutProfileSelector
                  clientId={isNew ? undefined : id}
                  selectedProfiles={selectedSproutProfiles}
                  onSelectionChange={setSelectedSproutProfiles}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="strategy" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Content Strategy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label>Content Pillars</Label>
                  <p className="text-xs text-muted-foreground">
                    Define your content pillars with descriptions to guide content strategy
                  </p>
                  <div className="space-y-3">
                    {form.content_pillars.map((pillar, index) => (
                      <div key={index} className="p-3 rounded-md border bg-card space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{pillar.name}</span>
                          <Button variant="ghost" size="sm" onClick={() => removePillar(index)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          value={pillar.description}
                          onChange={(e) => updatePillarDescription(index, e.target.value)}
                          placeholder={`Describe what "${pillar.name}" content looks like — topics, tone, examples...`}
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newPillarName}
                      onChange={(e) => setNewPillarName(e.target.value)}
                      placeholder="Add a content pillar"
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPillar())}
                    />
                    <Button variant="outline" size="sm" onClick={addPillar}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Social Keywords</Label>
                  <p className="text-xs text-muted-foreground">
                    Add multi-word phrases used for TikTok/Instagram trend search. Enter one phrase at a time — do not
                    use commas.
                    <br />
                    Examples: "AI content strategy", "performance marketing tips", "social media automation"
                  </p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {form.social_keywords.map((k) => (
                      <Badge key={k} variant="outline" className="gap-1">
                        {k}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() =>
                            setForm((f) => ({ ...f, social_keywords: f.social_keywords.filter((x) => x !== k) }))
                          }
                        />
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newKeyword}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes(",")) {
                          toast({
                            title: "No commas needed",
                            description: "Press Enter or click + to add each keyword phrase separately.",
                          });
                        }
                        setNewKeyword(val);
                      }}
                      placeholder="Add keyword phrase (press Enter)"
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                    />
                    <Button variant="outline" size="sm" onClick={addKeyword}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brief" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client Brief</CardTitle>
                <CardDescription>
                  Brand voice, target audience, campaign objectives, and content restrictions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Brand Voice Preset</Label>
                  <p className="text-xs text-muted-foreground">
                    Select a tone that best matches this client's brand voice.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BRAND_VOICE_PRESETS.map((preset) => (
                      <Badge
                        key={preset}
                        variant={form.brand_voice_preset === preset ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            brand_voice_preset: f.brand_voice_preset === preset ? "" : preset,
                          }))
                        }
                      >
                        {preset}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Brand Notes</Label>
                  <Textarea
                    value={form.brand_notes}
                    onChange={(e) => setForm((f) => ({ ...f, brand_notes: e.target.value }))}
                    placeholder="Brand voice, positioning, key messaging..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Brand Book / Style Guide</Label>
                  <Textarea
                    value={form.brand_book_text}
                    onChange={(e) => setForm((f) => ({ ...f, brand_book_text: e.target.value }))}
                    placeholder="Paste brand book excerpts, style guide rules, visual identity guidelines, tone of voice rules..."
                    rows={5}
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste key excerpts from your brand book. These guidelines will be used by the AI when generating
                    content recommendations and visual directions.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Brief Text</Label>
                  <Textarea
                    value={form.brief_text}
                    onChange={(e) => setForm((f) => ({ ...f, brief_text: e.target.value }))}
                    rows={10}
                    placeholder={`Brand Voice: Professional yet approachable\nTarget Audience: B2B SaaS decision-makers\nCampaign Objectives: Increase brand awareness and thought leadership\nContent Restrictions: No competitor mentions\nCompetitive Positioning: Market leader in AI-powered analytics`}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Google Doc ID (optional)</Label>
                  <Input
                    value={form.brief_file_id}
                    onChange={(e) => setForm((f) => ({ ...f, brief_file_id: e.target.value }))}
                    placeholder="e.g., 1BxiMVs0XRA5nFMdKvBdBZjgmUii3ObRy2CmEkTzOQ5s"
                  />
                  <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1.5">
                    <p className="font-medium text-foreground flex items-center gap-1">
                      <Info className="h-3 w-3" /> How to find your Google Doc ID:
                    </p>
                    <ol className="list-decimal pl-4 space-y-1">
                      <li>Open your brief document in Google Docs</li>
                      <li>Look at the URL in your browser's address bar</li>
                      <li>
                        The ID is the long string between <code className="bg-background px-1 rounded">/d/</code> and{" "}
                        <code className="bg-background px-1 rounded">/edit</code>
                      </li>
                      <li>
                        Example: docs.google.com/document/d/<strong>1BxiMVs0XRA5nF...</strong>/edit
                      </li>
                    </ol>
                    <p>If provided, the AI analysis will use this Google Doc instead of the brief text above.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4 mt-4">
            {!isNew && id ? (
              <ReportScheduleManager clientId={id} />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Save the client first to configure report scheduling.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function ReportScheduleManager({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: schedule, isLoading } = useQuery({
    queryKey: ["report-schedule", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_schedules")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [frequency, setFrequency] = useState<string>("monthly");
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (schedule) {
      setFrequency(schedule.frequency || "monthly");
      setIsActive(schedule.is_active ?? false);
    }
  }, [schedule]);

  const computeNextRun = (freq: string): string => {
    const now = new Date();
    if (freq === "weekly") {
      const next = new Date(now);
      next.setDate(now.getDate() + ((7 - now.getDay()) % 7) || 7);
      next.setHours(9, 0, 0, 0);
      return next.toISOString();
    } else if (freq === "biweekly") {
      const next = new Date(now);
      next.setDate(now.getDate() + 14);
      next.setHours(9, 0, 0, 0);
      return next.toISOString();
    } else {
      // monthly - 1st of next month
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 9, 0, 0);
      return next.toISOString();
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        frequency,
        is_active: isActive,
        next_run_at: isActive ? computeNextRun(frequency) : null,
      };

      if (schedule) {
        const { error } = await supabase.from("report_schedules").update(payload).eq("id", schedule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("report_schedules").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-schedule", clientId] });
      toast({ title: "Schedule saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save schedule", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="animate-pulse text-muted-foreground">Loading schedule...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4 w-4" /> Report Schedule
        </CardTitle>
        <CardDescription>
          Automatically run reports on a recurring schedule. The report will use the default date range (current month).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Enable Scheduled Reports</Label>
            <p className="text-xs text-muted-foreground">Reports will run automatically at the configured frequency</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select value={frequency} onValueChange={setFrequency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Bi-weekly</SelectItem>
              <SelectItem value="monthly">Monthly (Recommended)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {schedule?.next_run_at && isActive && (
          <div className="text-sm text-muted-foreground">
            Next scheduled run:{" "}
            <span className="font-medium text-foreground">{new Date(schedule.next_run_at).toLocaleDateString()}</span>
          </div>
        )}

        {schedule?.last_run_at && (
          <div className="text-sm text-muted-foreground">
            Last run: {new Date(schedule.last_run_at).toLocaleDateString()}
          </div>
        )}

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Schedule
        </Button>
      </CardContent>
    </Card>
  );
}

function SproutProfileSelector({
  clientId,
  selectedProfiles,
  onSelectionChange,
}: {
  clientId?: string;
  selectedProfiles: any[];
  onSelectionChange: (profiles: any[]) => void;
}) {
  const [fetching, setFetching] = useState(false);
  const [allProfiles, setAllProfiles] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const { data: assignedProfiles } = useQuery({
    queryKey: ["sprout-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId!)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (assignedProfiles && allProfiles.length > 0 && selectedProfiles.length === 0) {
      const preSelected = allProfiles.filter((p) => assignedProfiles.some((a) => a.sprout_profile_id === p.id));
      if (preSelected.length > 0) onSelectionChange(preSelected);
    }
  }, [assignedProfiles, allProfiles]);

  const fetchProfiles = async () => {
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("sprout-profiles", {
        body: {},
      });
      if (error) throw error;
      setAllProfiles(data.profiles || []);
    } catch (err: any) {
      toast({ title: "Error fetching Sprout profiles", description: err.message, variant: "destructive" });
    } finally {
      setFetching(false);
    }
  };

  const toggleProfile = (profile: any) => {
    const isSelected = selectedProfiles.some((p) => p.id === profile.id);
    if (isSelected) {
      onSelectionChange(selectedProfiles.filter((p) => p.id !== profile.id));
    } else {
      onSelectionChange([...selectedProfiles, profile]);
    }
  };

  const platformIcon: Record<string, string> = {
    Facebook: "📘",
    Instagram: "📸",
    TikTok: "🎵",
    "Twitter/X": "𝕏",
    LinkedIn: "💼",
    YouTube: "▶️",
    Pinterest: "📌",
    Threads: "🧵",
  };

  const filteredProfiles = allProfiles
    .filter(
      (p) =>
        !searchTerm ||
        (p.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.native_name || "").toLowerCase().includes(searchTerm.toLowerCase()),
    )
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (fetching) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Sprout Social profiles...
      </div>
    );
  }

  if (allProfiles.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Could not load profiles.</p>
        <Button variant="outline" size="sm" onClick={fetchProfiles}>
          <RefreshCw className="h-4 w-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {selectedProfiles.length} of {allProfiles.length} profiles selected
        </p>
        <Button variant="ghost" size="sm" onClick={fetchProfiles}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <Input placeholder="Search by name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />

      <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
        {filteredProfiles.map((profile) => {
          const isSelected = selectedProfiles.some((p) => p.id === profile.id);
          return (
            <div
              key={profile.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected ? "bg-primary/10 border-primary/30" : "bg-card hover:bg-accent/30"
              }`}
              onClick={() => toggleProfile(profile)}
            >
              <Checkbox checked={isSelected} onCheckedChange={() => toggleProfile(profile)} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm">{profile.name}</span>
                {profile.native_name && (
                  <span className="text-muted-foreground text-xs ml-1.5">@{profile.native_name}</span>
                )}
              </div>
              <Badge variant={isSelected ? "default" : "secondary"} className="text-xs shrink-0 gap-1">
                {platformIcon[profile.network_display] || "🌐"} {profile.network_display}
              </Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
