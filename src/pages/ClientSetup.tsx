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
import { Save, Plus, X, RefreshCw, Loader2 } from "lucide-react";

const PLATFORMS = ["Instagram", "TikTok", "Facebook", "LinkedIn", "Twitter/X", "YouTube"];
const GEOS = ["US", "UK", "EU", "Global", "LATAM", "APAC"];
const LANGUAGES = ["en", "es", "fr", "de", "pt", "ja", "ko", "ar", "zh"];
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
    sprout_customer_id: "",
    social_keywords: [] as string[],
    content_pillars: [...DEFAULT_PILLARS] as ContentPillar[],
    primary_platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn"],
    geo: "US",
    language: "en",
    brand_notes: "",
    brief_text: "",
    brief_file_id: "",
  });
  const [newKeyword, setNewKeyword] = useState("");
  const [newPillarName, setNewPillarName] = useState("");

  const { data: client } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
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
            typeof p === "string" ? { name: p, description: "" } : { name: p.name || "", description: p.description || "" }
          );
        }
      }
      setForm({
        name: client.name || "",
        sprout_customer_id: client.sprout_customer_id || "",
        social_keywords: client.social_keywords || [],
        content_pillars: pillars,
        primary_platforms: client.primary_platforms || ["Instagram", "TikTok", "Facebook", "LinkedIn"],
        geo: client.geo || "US",
        language: client.language || "en",
        brand_notes: client.brand_notes || "",
        brief_text: client.brief_text || "",
        brief_file_id: client.brief_file_id || "",
      });
    }
  }, [client]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        content_pillars: form.content_pillars as any,
      };
      if (isNew) {
        const { data, error } = await supabase
          .from("clients")
          .insert({ ...payload, created_by: user!.id } as any)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { error } = await supabase
          .from("clients")
          .update(payload as any)
          .eq("id", id!);
        if (error) throw error;
        return { id };
      }
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
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
    if (newKeyword.trim() && !form.social_keywords.includes(newKeyword.trim())) {
      setForm((f) => ({ ...f, social_keywords: [...f.social_keywords, newKeyword.trim()] }));
      setNewKeyword("");
    }
  };

  const addPillar = () => {
    if (newPillarName.trim() && !form.content_pillars.some((p) => p.name === newPillarName.trim())) {
      setForm((f) => ({ ...f, content_pillars: [...f.content_pillars, { name: newPillarName.trim(), description: "" }] }));
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
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name}>
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>

        <Tabs defaultValue="info">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Client Info</TabsTrigger>
            <TabsTrigger value="sprout">Sprout Social</TabsTrigger>
            <TabsTrigger value="strategy">Content Strategy</TabsTrigger>
            <TabsTrigger value="brief">Brief</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Client Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g., Acme Corp" />
                </div>
                <div className="space-y-2">
                  <Label>Brand Notes</Label>
                  <Textarea value={form.brand_notes} onChange={(e) => setForm((f) => ({ ...f, brand_notes: e.target.value }))} placeholder="Brand voice, positioning, key messaging..." rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Primary Platforms</Label>
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Geographic Focus</Label>
                    <Select value={form.geo} onValueChange={(v) => setForm((f) => ({ ...f, geo: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {GEOS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select value={form.language} onValueChange={(v) => setForm((f) => ({ ...f, language: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sprout" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sprout Social Connection</CardTitle>
                <CardDescription>Connect to Sprout Social to pull performance data</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Sprout Customer ID</Label>
                  <Input value={form.sprout_customer_id} onChange={(e) => setForm((f) => ({ ...f, sprout_customer_id: e.target.value }))} placeholder="e.g., 1676448" />
                  <p className="text-xs text-muted-foreground">Find this in your Sprout Social admin settings</p>
                </div>
                {!isNew && form.sprout_customer_id && (
                  <SproutProfileManager clientId={id!} sproutCustomerId={form.sprout_customer_id} />
                )}
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
                  <p className="text-xs text-muted-foreground">Define your content pillars with descriptions to guide content strategy</p>
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
                    <Input value={newPillarName} onChange={(e) => setNewPillarName(e.target.value)} placeholder="Add a content pillar" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPillar())} />
                    <Button variant="outline" size="sm" onClick={addPillar}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Social Keywords</Label>
                  <p className="text-xs text-muted-foreground">Multi-word phrases for TikTok/Instagram trend search. e.g., "AI content strategy", "performance marketing tips"</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {form.social_keywords.map((k) => (
                      <Badge key={k} variant="outline" className="gap-1">
                        {k}
                        <X className="h-3 w-3 cursor-pointer" onClick={() => setForm((f) => ({ ...f, social_keywords: f.social_keywords.filter((x) => x !== k) }))} />
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Add keyword phrase" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())} />
                    <Button variant="outline" size="sm" onClick={addKeyword}><Plus className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="brief" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Client Brief</CardTitle>
                <CardDescription>Brand voice, target audience, campaign objectives, and content restrictions</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
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
                  <Input value={form.brief_file_id} onChange={(e) => setForm((f) => ({ ...f, brief_file_id: e.target.value }))} placeholder="Google Drive file ID" />
                  <p className="text-xs text-muted-foreground">If provided, the analysis will use the Google Doc content instead of the text above</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function SproutProfileManager({ clientId, sproutCustomerId }: { clientId: string; sproutCustomerId: string }) {
  const [fetching, setFetching] = useState(false);
  const [availableProfiles, setAvailableProfiles] = useState<any[]>([]);
  const [grouped, setGrouped] = useState<Record<string, any[]>>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: assignedProfiles } = useQuery({
    queryKey: ["sprout-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const fetchProfiles = async () => {
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("sprout-profiles", {
        body: { sprout_customer_id: sproutCustomerId },
      });
      if (error) throw error;
      setAvailableProfiles(data.profiles || []);
      setGrouped(data.grouped_by_network || {});
    } catch (err: any) {
      toast({ title: "Error fetching profiles", description: err.message, variant: "destructive" });
    } finally {
      setFetching(false);
    }
  };

  const toggleProfile = async (profile: any) => {
    const isAssigned = assignedProfiles?.some((p) => p.sprout_profile_id === profile.id);
    try {
      if (isAssigned) {
        await supabase.from("sprout_profiles").delete().eq("client_id", clientId).eq("sprout_profile_id", profile.id);
      } else {
        await supabase.from("sprout_profiles").insert({
          client_id: clientId,
          sprout_profile_id: profile.id,
          profile_name: profile.name,
          native_name: profile.native_name,
          network_type: profile.network_type,
          native_link: profile.native_link,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["sprout-profiles", clientId] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={fetchProfiles} disabled={fetching}>
        {fetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        {availableProfiles.length > 0 ? "Refresh Profiles" : "Fetch Available Profiles"}
      </Button>

      {assignedProfiles && assignedProfiles.length > 0 && !availableProfiles.length && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Assigned Profiles ({assignedProfiles.length})</Label>
          <div className="space-y-1">
            {assignedProfiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded bg-muted text-sm">
                <span>{p.native_name || p.profile_name} — <span className="text-muted-foreground">{p.network_type}</span></span>
                <Button variant="ghost" size="sm" onClick={() => toggleProfile({ id: p.sprout_profile_id })}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {Object.entries(grouped).map(([network, profiles]) => (
        <div key={network} className="space-y-2">
          <Label className="text-sm font-medium">{network}</Label>
          <div className="space-y-1">
            {profiles.map((profile: any) => {
              const isAssigned = assignedProfiles?.some((p) => p.sprout_profile_id === profile.id);
              return (
                <div key={profile.id} className="flex items-center gap-3 p-2 rounded bg-muted">
                  <Checkbox checked={isAssigned} onCheckedChange={() => toggleProfile(profile)} />
                  <div className="flex-1 text-sm">
                    <span className="font-medium">{profile.native_name || profile.name}</span>
                    {profile.native_link && (
                      <a href={profile.native_link} target="_blank" rel="noopener" className="ml-2 text-xs text-accent hover:underline">View</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
