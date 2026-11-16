// server/src/log.ts
//
// The one log line shape of the picture service: a plain object written as a
// single JSON line on stdout, which Vercel keeps as the function's log. Tests
// pass their own Log to collect lines instead.

export type Log = (line: Record<string, unknown>) => void;

export const stdoutLog: Log = (line) => {
  console.log(JSON.stringify(line));
};
