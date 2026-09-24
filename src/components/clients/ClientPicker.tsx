import { Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";

type ClientOption = { id: string; name: string; logo_url?: string | null };

/** One explicit client context for the actions alongside this directory. */
export function ClientPicker({ clients, selectedId, onSelect, search, onSearch }: {
  clients: ClientOption[]; selectedId?: string; onSelect: (id: string) => void;
  search: string; onSearch: (value: string) => void;
}) {
  return <aside className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3 self-start">
    <label className="block text-sm font-medium" htmlFor="client-directory-search">Choose a client</label>
    <div className="relative">
      <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input id="client-directory-search" type="search" placeholder="Search clients…" value={search} onChange={e => onSearch(e.target.value)} className="pl-9" />
    </div>
    <div className="flex gap-2 overflow-x-auto lg:flex-col lg:max-h-[65vh] lg:overflow-y-auto" role="group" aria-label="Clients">
      {clients.map(client => <button key={client.id} type="button" aria-pressed={selectedId === client.id} onClick={() => onSelect(client.id)}
        className={`flex shrink-0 items-center gap-3 rounded-lg border px-3 py-3 text-left min-w-[180px] lg:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedId === client.id ? 'border-primary/50 bg-primary/10 text-white' : 'border-transparent hover:bg-white/5 text-muted-foreground'}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-semibold text-white" aria-hidden="true">
          {client.logo_url ? <img src={client.logo_url} alt="" className="h-full w-full rounded-lg object-contain" /> : client.name.slice(0,2).toUpperCase()}
        </span>
        <span className="flex-1 font-medium break-words">{client.name}</span>
        {selectedId === client.id && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </button>)}
    </div>
    {!clients.length && <p className="t-secondary">No clients match your search.</p>}
  </aside>;
}
