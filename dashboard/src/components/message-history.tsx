"use client";
import { useActionState, useState } from "react";
import { ChevronDown, Trash2, Search, CheckCheck, Eye } from "lucide-react";
import { deleteMessages } from "@/app/(app)/messages/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import { markCommunicationRead } from "./notification-bell";
import { MessageForm } from "./message-form";

export type Notice = { id: string; title: string; body: string; time: string; canDelete: boolean;
  receipts: { id: string; name: string; studentId: string; opened: string; acknowledged: string; status: string }[] };
export type StudentReply = { id: string; unread?: boolean; deviceId: string; name: string; anonymous: boolean; time: string; body: string };

export function MessageHistory({ notices, replies }: { notices: Notice[]; replies: StudentReply[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [state, action, pending] = useActionState(deleteMessages, undefined);
  const shown = notices.filter(n => `${n.title} ${n.body} ${n.receipts.map(r => r.name).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const ids = notices.filter(n => selected.includes(n.id)).map(n => n.receipts[0].id);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><Search size={16} className="text-slate-400"/><input className="bg-transparent text-sm outline-none" placeholder="Search notices or students" aria-label="Search messages" value={query} onChange={e => setQuery(e.target.value)}/></label>
      {ids.length > 0 && <form action={action}><input type="hidden" name="ids" value={JSON.stringify(ids)}/><SubmitButton className="btn-secondary" disabled={pending} confirm="Delete the selected notices? Student copies will be removed when upgraded Primebooks reconnect."><Trash2 size={15}/> Delete selected ({selected.length})</SubmitButton></form>}
    </div>
    <FormMessage state={state}/>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {shown.map(n => <div key={n.id} className="border-b border-slate-100 last:border-0">
        <div className="flex items-start gap-3 px-4 py-3">
          {n.canDelete && <input type="checkbox" className="mt-2 accent-violet-600" aria-label={`Select ${n.title}`} checked={selected.includes(n.id)} onChange={e => setSelected(e.target.checked ? [...selected,n.id] : selected.filter(id => id !== n.id))}/>}
          <details className="min-w-0 flex-1"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-800">{n.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{n.body.replace(/\n/g," ").slice(0,120)}</p><p className="mt-2 text-xs text-slate-400">{n.time} · {n.receipts.length} recipients</p></div><div className="flex shrink-0 items-center gap-4 text-xs text-slate-500"><span className="flex items-center gap-1" title="Opened"><Eye size={14}/>{n.receipts.filter(r => r.opened).length}</span><span className="flex items-center gap-1 text-emerald-600" title="Acknowledged"><CheckCheck size={14}/>{n.receipts.filter(r => r.acknowledged).length}</span><ChevronDown size={15}/></div></summary>
            <p className="my-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{n.body}</p>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="py-2">Student</th><th>Opened</th><th>Acknowledged / delivery</th></tr></thead><tbody>{n.receipts.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="py-2 pr-3"><b>{r.name}</b><div className="text-slate-400">{r.studentId}</div></td><td className="pr-3">{r.opened || "Not yet"}</td><td>{r.acknowledged || r.status}</td></tr>)}</tbody></table></div>
          </details>
          {n.canDelete && <form action={action}><input type="hidden" name="ids" value={JSON.stringify([n.receipts[0].id])}/><SubmitButton className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" pending="…" confirm="Delete this notice? Student copies will be removed when upgraded Primebooks reconnect."><Trash2 size={16}/><span className="sr-only">Delete {n.title}</span></SubmitButton></form>}
        </div>
      </div>)}
      {!shown.length && <p className="p-8 text-center text-sm text-slate-400">No messages to show.</p>}
    </div>
    <section><h2 className="mb-3 text-sm font-semibold">Student replies <span className="font-normal text-slate-400">({replies.length})</span></h2><div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">{replies.map(r => <details id={`reply-${r.id}`} key={r.id} className="scroll-mt-24 p-4" onToggle={event=>{if(event.currentTarget.open&&r.unread)void markCommunicationRead("reply",[r.id]).catch(()=>{});}}><summary className="cursor-pointer text-sm"><span className="font-medium">{r.unread&&<span className="mr-2 text-[10px] font-semibold text-brand-600">NEW</span>}{r.name}{r.anonymous ? " (anonymous)" : ""}</span><span className="ml-3 text-xs text-slate-400">{r.time}</span><span className="mt-1 block truncate text-xs text-slate-500">{r.body.slice(0,120)}</span></summary><p className="my-3 whitespace-pre-wrap text-sm">{r.body}</p><MessageForm target={r.deviceId} collapsible label="Reply"/></details>)}{!replies.length && <p className="p-5 text-sm text-slate-400">No replies yet.</p>}</div></section>
  </div>;
}
