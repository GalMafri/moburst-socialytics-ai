// Finding an existing auth user by email, without assuming the whole tenant
// fits on one page.
//
// Both bridges used to do this:
//
//   const { data } = await supabase.auth.admin.listUsers();
//   const existing = data?.users?.find(u => u.email?.toLowerCase() === email);
//
// listUsers() returns the FIRST PAGE, fifty rows by default. Under fifty
// accounts that is indistinguishable from correct. Over fifty, a user whose
// row sorts onto page two is simply not found, so the bridge takes its
// "create" branch, createUser fails because the address already exists, and
// the person is told "Failed to provision user" and cannot sign in at all.
// It is a cliff, not a slope: nothing degrades until the day it breaks, and
// it breaks for whoever happens to sort late.
//
// auth.users has 25 rows today.

export interface FoundUser {
  id: string;
  email?: string | null;
}

/** Page through the admin user list until the address turns up, or it runs out. */
export async function findAuthUserByEmail(
  supabase: {
    auth: {
      admin: {
        listUsers(args?: { page?: number; perPage?: number }): Promise<{
          data: { users?: Array<{ id: string; email?: string | null }> } | null;
          error: unknown;
        }>;
      };
    };
  },
  email: string,
): Promise<FoundUser | null> {
  const wanted = email.trim().toLowerCase();
  const perPage = 200;
  // A ceiling so a paging bug cannot spin forever. 200 x 50 is 10,000 users,
  // far past anything this tool will hold, and the loop exits on a short page
  // long before then.
  const maxPages = 50;

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email || "").trim().toLowerCase() === wanted);
    if (hit) return hit;
    if (users.length < perPage) return null; // short page means that was the last one
  }

  // Ran out of pages without finding them. Say so rather than reporting "no
  // such user", which would send the caller down a create path that fails.
  throw new Error(
    `Could not finish searching for ${email}: more than ${maxPages * perPage} accounts exist.`,
  );
}
