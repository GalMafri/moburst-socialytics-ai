// Share profile-path validation with automatic detection so pasted discovery
// pages and lookalike domains cannot become company handles.
import { classifyUrl } from "../../supabase/functions/_shared/competitive/extractSocialHandles";

export function isProfileUrlInput(value: string): boolean {
  return /[:/]/.test(value);
}

export function classifyProfileUrl(value: string): { platform: string; handle: string; profile_url: string } | null {
  const raw = String(value || "").trim();
  if (!isProfileUrlInput(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`);
  } catch { return null; }
  const profile = classifyUrl(url.toString());
  return profile ? { platform: profile.platform, handle: profile.handle, profile_url: url.toString() } : null;
}
