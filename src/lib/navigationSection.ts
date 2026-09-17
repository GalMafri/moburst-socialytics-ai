export function activeNavigationSection(path: string): string {
  if (/^\/clients\/[^/]+\/competitive(?:\/|$)/.test(path) || /^\/competitive(?:\/|$)/.test(path)) return "/competitive";
  if (/^\/clients\/[^/]+\/analytics(?:\/|$)/.test(path) || /^\/analytics(?:\/|$)/.test(path)) return "/analytics";
  if (/^\/clients\/[^/]+\/(?:reports|analyze)(?:\/|$)/.test(path) || /^\/reports(?:\/|$)/.test(path)) return "/reports";
  if (/^\/usage(?:\/|$)/.test(path)) return "/usage";
  if (/^\/settings(?:\/|$)/.test(path)) return "/settings";
  return "/";
}
