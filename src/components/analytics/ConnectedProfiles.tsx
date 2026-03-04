import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformBadge } from "@/lib/platform-config";

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
        <CardTitle className="text-base">
          Connected Profiles{" "}
          <span className="font-normal text-muted-foreground text-sm">({profiles.length} profiles)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {profiles.map((p, i) => {
            const displayPlatform = getDisplayPlatform(p.network);
            return (
              <PlatformBadge key={i} platform={displayPlatform} />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
