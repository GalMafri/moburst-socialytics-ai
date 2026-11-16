// A stand-in for the admin client the portal bridges use, recording every
// call so a test can say what was and was not done to an account.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface FakeAdminOptions {
  existing?: { id: string; email: string; app_metadata?: Row } | null;
  clients?: Array<{ id: string; hub_company_name: string }>;
  failProfile?: boolean;
  failRole?: boolean;
  failLink?: boolean;
  failClientAccess?: boolean;
  /** How many magic link verifications fail before one succeeds. */
  otpFailures?: number;
  /** access token -> user id, for admin.auth.getUser(token). */
  tokens?: Record<string, string>;
}

export function fakeAdmin(opts: FakeAdminOptions = {}) {
  const calls = { updateUser: [] as Row[], createUser: [] as Row[], profiles: [] as Row[], roles: [] as Row[], clientAccess: [] as Row[], links: [] as Row[], otps: [] as Row[], adminOtps: [] as Row[], signOuts: [] as Row[] };
  const admin = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: opts.existing ? [opts.existing] : [] }, error: null }),
        updateUserById: async (id: string, attrs: Row) => { calls.updateUser.push({ id, ...attrs }); return { data: {}, error: null }; },
        createUser: async (attrs: Row) => { calls.createUser.push(attrs); return { data: { user: { id: "new-user" } }, error: null }; },
        signOut: async (jwt: string, scope: string) => { calls.signOuts.push({ jwt, scope }); return { error: null }; },
        generateLink: async (args: Row) => { calls.links.push(args); return opts.failLink ? { data: null, error: { message: "boom" } } : { data: { properties: { hashed_token: "hash-1" } }, error: null }; },
      },
      getUser: async (jwt: string) => (opts.tokens?.[jwt] ? { data: { user: { id: opts.tokens[jwt] } }, error: null } : { data: { user: null }, error: { message: "invalid jwt" } }),
      // The caller's admin client must never verify a link: that would put the person's session on it.
      verifyOtp: async (args: Row) => { calls.adminOtps.push(args); return { data: { session: null }, error: { message: "wrong client" } }; },
    },
    from: (table: string) => ({
      upsert: async (row: Row) => { if (table === "profiles") { calls.profiles.push(row); return { error: opts.failProfile ? { message: "duplicate key (secret detail)" } : null }; } return { error: null }; },
      select: () => ({ not: async () => ({ data: opts.clients ?? [], error: null }) }),
    }),
    rpc: async (name: string, args: Row) => {
      if (name === "set_client_access") { calls.clientAccess.push(args); return { error: opts.failClientAccess ? { message: "foreign key (secret detail)" } : null }; }
      if (name === "set_user_role") calls.roles.push(args);
      return { error: name === "set_user_role" && opts.failRole ? { message: "duplicate key (secret detail)" } : null };
    },
  };
  // The short-lived client the helper mints the session with.
  let otpFailures = opts.otpFailures ?? 0;
  const mint = { auth: { verifyOtp: async (args: Row) => {
    calls.otps.push(args);
    if (otpFailures > 0) { otpFailures--; return { data: { session: null }, error: { message: "Email link is invalid or has expired" } }; }
    return { data: { session: { access_token: "a", refresh_token: "r" } }, error: null };
  } } };
  return { admin, mint, calls };
}
