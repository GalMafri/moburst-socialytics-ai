import { useEffect, useState } from "react";

/** True while the viewport matches a CSS media query; tracks changes live. */
export function useMediaQuery(query: string): boolean {
  const read = () => (typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState<boolean>(read);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
