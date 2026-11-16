import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformBadge } from "@/lib/platform-config";
import { countOf } from "@/lib/display";

/** Map Sprout Social network identifiers to user-friendly platform names */
const NETWORK_MAP: Record<string, string> = {
  fb_instagram_account: "Instagram",
  instagram: "Instagram",
  facebook: "Facebook",
  facebook_page: "Facebook",
  linkedin_company: "LinkedIn",
  linkedin: "LinkedIn",
  twitter: "Twitter",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};

function getDisplayPlatform(network: string): string {
  const key = network.toLowerCase().trim();
  return NETWORK_MAP[key] || network.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Props {
  profiles: { name: string; network: string }[];
}

export function ConnectedProfiles({ profiles }: Props) {
  if (!profiles.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="t-h3">
          Connected profiles{" "}
          <span className="font-normal text-muted-foreground t-body">({countOf(profiles.length, "profile")})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {profiles.map((p, i) => (
            <div key={i} className="flex items-center gap-2 min-w-0">
              <PlatformBadge platform={getDisplayPlatform(p.network)} />
              {p.name && <span className="t-body truncate">{p.name}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
