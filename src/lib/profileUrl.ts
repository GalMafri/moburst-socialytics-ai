// A pasted social profile URL, read for its platform and handle.
//
// Someone correcting a competitor's handle pastes the profile link far more
// often than they type "@name", and the two have to end up the same row.

const HOSTS: Array<[RegExp, string]> = [
  [/instagram\.com/i, "instagram"],
  [/facebook\.com|fb\.com/i, "facebook"],
  [/tiktok\.com/i, "tiktok"],
  [/linkedin\.com/i, "linkedin"],
  [/youtube\.com|youtu\.be/i, "youtube"],
  [/twitter\.com|x\.com/i, "x"],
];

export function classifyProfileUrl(value: string): { platform: string; handle: string; profile_url: string } | null {
  const raw = String(value || "").trim();
  if (!/^(https?:)?\/\//i.test(raw) && !/\.[a-z]{2,}\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw.replace(/^\/\//, "")}`);
  } catch {
    return null;
  }
  const platform = HOSTS.find(([re]) => re.test(url.hostname))?.[1];
  if (!platform) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return null;
  let handle = parts[0].replace(/^@/, "");
  if (platform === "linkedin" && ["company", "showcase", "school"].includes(parts[0])) handle = parts[1] || "";
  if (platform === "youtube" && ["channel", "c", "user"].includes(parts[0])) handle = parts[1] || "";
  if (!handle) return null;
  return { platform, handle, profile_url: url.toString() };
}
