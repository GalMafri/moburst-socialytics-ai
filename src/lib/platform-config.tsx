import React, { useEffect, useState } from "react";

// Official brand colors for social platforms
export const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "#000000",
  instagram: "#E4405F",
  facebook: "#1877F2",
  twitter: "#1DA1F2",
  x: "#000000",
  linkedin: "#0A66C2",
  youtube: "#FF0000",
  pinterest: "#E60023",
  snapchat: "#FFFC00",
  threads: "#000000",
};

// For dark mode where black logos won't be visible
const PLATFORM_COLORS_DARK: Record<string, string> = {
  tiktok: "#25F4EE",
  x: "#FFFFFF",
  threads: "#FFFFFF",
};

export function getPlatformColor(platform: string, isDark = false): string {
  const key = platform.toLowerCase().trim();
  if (isDark && PLATFORM_COLORS_DARK[key]) return PLATFORM_COLORS_DARK[key];
  return PLATFORM_COLORS[key] || "hsl(var(--primary))";
}

// SVG logo components for each platform
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.72a8.2 8.2 0 0 0 4.76 1.5V6.8a4.83 4.83 0 0 1-1-.11z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

function PinterestIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24 18.635 24 24 18.633 24 12.013 24 5.367 18.635 0 12.017 0z" />
    </svg>
  );
}

function SnapchatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12.989-.303a.59.59 0 0 1 .286-.076c.2 0 .37.088.5.2.2.18.33.42.24.68-.14.4-.62.58-1.17.73-.19.05-.36.12-.53.2-.24.12-.42.29-.49.48-.06.16-.03.33.09.49.26.41.61.81 1.03 1.15.74.58 1.59.95 2.54 1.09.26.04.46.18.46.46-.02.24-.2.45-.45.56-.63.29-1.26.4-1.93.51-.05.01-.11.06-.14.12-.08.18-.15.36-.23.54-.11.25-.27.43-.6.43-.12 0-.26-.02-.42-.07a4.35 4.35 0 0 0-1.32-.2c-.27 0-.53.02-.79.06-.49.07-.87.35-1.33.69-.73.54-1.64 1.21-3.46 1.21-1.82 0-2.74-.67-3.47-1.21-.46-.34-.84-.62-1.33-.69a4.62 4.62 0 0 0-.79-.06c-.47 0-.94.07-1.32.2-.16.05-.3.07-.42.07-.33 0-.5-.18-.6-.43-.08-.18-.15-.36-.23-.54-.03-.06-.09-.11-.14-.12-.67-.11-1.3-.22-1.93-.51-.25-.11-.43-.32-.45-.56 0-.28.2-.42.46-.46.95-.14 1.8-.51 2.54-1.09.42-.34.77-.74 1.03-1.15.12-.16.15-.33.09-.49-.07-.19-.25-.36-.49-.48-.17-.08-.34-.15-.53-.2-.55-.15-1.03-.33-1.17-.73-.09-.26.04-.5.24-.68.13-.12.3-.2.5-.2.09 0 .19.02.28.08.33.18.69.3.99.3.2 0 .33-.04.4-.09a6.37 6.37 0 0 1-.03-.51l-.003-.06c-.104-1.628-.23-3.654.3-4.847C7.86 1.07 11.216.793 12.206.793z" />
    </svg>
  );
}

function ThreadsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.96-.065-1.186.408-2.228 1.33-2.935.81-.62 1.9-.942 3.07-.907.86.026 1.647.196 2.346.479-.07-.458-.17-.885-.3-1.278-.38-1.177-1.07-1.983-2.05-2.393-.51-.213-1.1-.333-1.77-.357l-.12-.004a7.975 7.975 0 0 0-1.49.127l-.405-2.02a9.852 9.852 0 0 1 1.902-.163l.152.005c1.03.037 1.96.234 2.76.589 1.48.654 2.529 1.796 3.112 3.39.283.776.467 1.628.55 2.55.56.243 1.065.533 1.51.87 1.13.857 1.94 2.005 2.37 3.37.562 1.78.392 4.377-1.675 6.401-1.755 1.72-4.03 2.476-7.16 2.497z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<string, React.FC<{ className?: string }>> = {
  tiktok: TikTokIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  twitter: TwitterIcon,
  x: TwitterIcon,
  linkedin: LinkedInIcon,
  youtube: YouTubeIcon,
  pinterest: PinterestIcon,
  snapchat: SnapchatIcon,
  threads: ThreadsIcon,
};

export function PlatformIcon({ platform, className = "h-4 w-4" }: { platform: string; className?: string }) {
  const key = platform.toLowerCase().trim();
  const Icon = PLATFORM_ICONS[key];
  if (!Icon) return null;
  return <Icon className={className} />;
}

/** A badge with platform-specific color and icon */
export function PlatformBadge({
  platform,
  className = "",
  size = "default",
}: {
  platform: string;
  className?: string;
  size?: "default" | "sm";
}) {
  const [isDark, setIsDark] = useState(
    typeof window !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const color = getPlatformColor(platform, isDark);
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium ${textSize} ${className}`}
      style={{
        borderColor: `${color}40`,
        backgroundColor: `${color}15`,
        color: color,
      }}
    >
      <PlatformIcon platform={platform} className={iconSize} />
      {platform}
    </span>
  );
}
