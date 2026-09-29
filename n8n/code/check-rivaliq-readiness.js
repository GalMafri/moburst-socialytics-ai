const status = $input.first().json.status;
if (status !== 1 && status !== 2) {
  throw new Error('RivalIQ did not return a valid data-readiness status. No analysis was started.');
}
if (status === 2 && $runIndex >= 30) {
  throw new Error('RivalIQ is still collecting source data after 30 minutes. Retry this report after tracking has finished; no incomplete figures were released.');
}
return [{ json: { status, ready: status === 1, checks: $runIndex + 1 } }];
