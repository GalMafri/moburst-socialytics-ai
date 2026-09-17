const result = $input.first().json;
const state = String(result.status || result.data?.status || '').toLowerCase();
const attempt = $runIndex + 1;
const pending = ['pending', 'queued', 'processing', 'running', 'in_progress'].includes(state);
return [{ json: { ...result, _gamma_attempt: attempt, _gamma_poll_again: pending && attempt < 20, _gamma_timeout: pending && attempt >= 20 } }];
