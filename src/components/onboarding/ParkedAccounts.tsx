// The accounts of a client that are not used (staff only, setup page): each
// with why in one plain sentence and a way to add it back. An account added
// back is saved with the page, like any account a person adds, and from then
// on it is the one in use on its network (src/lib/parkedAccounts.ts).

import { Button } from "@/components/ui/button";
import { PlatformIcon } from "@/lib/platform-config";
import { parkedLine, type ParkedAccount } from "@/lib/parkedAccounts";

export function ParkedAccounts({ accounts, onAddBack }: { accounts: ParkedAccount[]; onAddBack: (account: ParkedAccount) => void }) {
  if (!accounts.length) return null;
  return (
    <div className="glass-inner p-inner space-y-2">
      <p className="t-subhead">Not used</p>
      <ul className="space-y-3">
        {accounts.map((account) => (
          <li key={String(account.sprout_profile_id)} className="space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <PlatformIcon platform={account.network_type ?? ""} className="h-4 w-4 shrink-0" />
              <span className="t-body truncate">{account.profile_name}</span>
              {account.native_name && <span className="t-label truncate">@{account.native_name}</span>}
              <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={() => onAddBack(account)} aria-label={`Add ${account.profile_name ?? "this account"} back`}>
                Add it back
              </Button>
            </div>
            <p className="t-label">{parkedLine(account.parked_reason)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
