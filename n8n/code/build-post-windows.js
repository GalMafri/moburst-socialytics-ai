// RivalIQ caps socialposts at 100 per call. Split the period into windows of
// at most 7 days so a busy landscape never loses posts; the HTTP node runs
// once per window, serially (the account allows one concurrent call).
const cfg = $("Run Config").first().json;
const landscapeId = $("Resolve Landscape").first().json.landscape_id;
const start = new Date(cfg.range_start + "T00:00:00Z");
const end = new Date(cfg.range_end + "T00:00:00Z");
if (isNaN(start) || isNaN(end) || end < start) throw new Error("Invalid date range: " + cfg.range_start + " to " + cfg.range_end);
const day = 86400000;
const fmt = (d) => d.toISOString().slice(0, 10);
const windows = [];
let cursor = new Date(start);
while (cursor <= end) {
  const stop = new Date(Math.min(cursor.getTime() + 6 * day, end.getTime()));
  windows.push({ landscape_id: landscapeId, mainPeriodStart: fmt(cursor), mainPeriodEnd: fmt(stop), window_index: windows.length });
  cursor = new Date(stop.getTime() + day);
}
if (windows.length > 60) throw new Error("Range too long for a single run (" + windows.length + " windows)");
return windows.map((w) => ({ json: w }));
