import { Search, Check } from "lucide-react";
import { Input } from "@/components/ui/input";

type ClientOption = { id: string; name: string; logo_url?: string | null };

/** One explicit client context for the actions alongside this directory. */
export function ClientPicker({ clients, selectedId, onSelect, search, onSearch }: {
  clients: ClientOption[]; selectedId?: string; onSelect: (id: string) => void;
  search: string; onSearch: (value: string) => void;
}) {
  return <aside className="glass p-inner space-y-3 self-start lg:sticky lg:top-6">
    <label className="block t-h4" htmlFor="client-directory-search">Choose a client</label>
    <div className="relative">
      <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#b1b7c1]" />
      <Input id="client-directory-search" type="search" placeholder="Search clients…" value={search} onChange={e => onSearch(e.target.value)} className="pl-9" />
    </div>
    <div className="flex gap-2 overflow-x-auto lg:flex-col lg:max-h-[65vh] lg:overflow-y-auto" role="group" aria-label="Clients">
      {clients.map(client => <button key={client.id} type="button" aria-pressed={selectedId === client.id} onClick={() => onSelect(client.id)}
        className={`flex shrink-0 items-center gap-3 px-3 py-2.5 text-left min-w-[180px] lg:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedId === client.id ? 'glass-inner is-selected text-white' : 'rounded-[12px] border border-transparent hover:bg-white/5 text-[#d1d5db]'}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-white/10 t-badge text-white" aria-hidden="true">
          {client.logo_url ? <img src={client.logo_url} alt="" className="h-full w-full rounded-[8px] object-contain" /> : client.name.slice(0,2).toUpperCase()}
        </span>
        <span className="flex-1 t-body font-medium break-words">{client.name}</span>
        {selectedId === client.id && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </button>)}
    </div>
    {!clients.length && <p className="t-label">No clients match your search.</p>}
  </aside>;
}
