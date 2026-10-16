'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, MessageCircle, Mail, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

type Entry = { id: string; kind: 'support'|'reply'; device_id: string; name: string; title: string; preview: string; created_at: string };
export async function markCommunicationRead(kind: string, ids: string[]) {
  if (!ids.length) return;
  const response = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ids }) });
  if (!response.ok) throw Error('Could not save read status.');
  window.dispatchEvent(new Event('communication-read'));
}
export function ReadMessages({ kind, ids }: { kind: string; ids: string[] }) {
  const key = JSON.stringify(ids);
  useEffect(() => {
    let completed = false;
    const read = () => { if (!completed && document.visibilityState === 'visible') markCommunicationRead(kind, JSON.parse(key)).then(() => { completed = true; }).catch(() => {}); };
    read(); window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, [kind, key]);
  return null;
}
export function NotificationBell() {
  const [data, setData] = useState<{total:number;items:Entry[]}>({total:0,items:[]}), [open,setOpen] = useState(false), [failed,setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null), fingerprint = useRef(''), router = useRouter(), pathname = usePathname();
  const load = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const response = await fetch('/api/notifications', { cache:'no-store' });
      if (!response.ok) throw Error();
      const next = await response.json();
      const signature = JSON.stringify(next);
      if (fingerprint.current && signature !== fingerprint.current && ['/support','/messages'].includes(pathname)) router.refresh();
      fingerprint.current = signature; setData(next); setFailed(false);
    } catch { setFailed(true); }
  }, [pathname,router]);
  useEffect(() => { const first=setTimeout(load,0); const timer = setInterval(load,20000); window.addEventListener('focus',load); window.addEventListener('communication-read',load); return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener('focus',load); window.removeEventListener('communication-read',load); }; },[load]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } };
    document.addEventListener('mousedown',close); document.addEventListener('keydown',key);
    return () => { document.removeEventListener('mousedown',close); document.removeEventListener('keydown',key); };
  },[open]);
  return <div className="relative" ref={root}><button type="button" className="icon-button relative" aria-label={`Notifications${data.total?`, ${data.total} unread`:''}`} aria-expanded={open} onClick={()=>setOpen(!open)}><Bell size={17}/>{data.total>0&&<span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-brand-600 px-1 text-[9px] leading-4 text-white">{data.total>99?'99+':data.total}</span>}</button>
    {open&&<section className="absolute top-11 right-0 z-50 w-[min(360px,85vw)] overflow-hidden rounded-xl border border-line bg-white shadow-xl" aria-label="Notifications"><div className="flex items-center justify-between border-b border-line p-3"><b className="text-sm">Notifications</b><button className="icon-button" aria-label="Close notifications" onClick={()=>setOpen(false)}><X size={15}/></button></div><div className="max-h-[65vh] overflow-y-auto">{failed&&<p role="status" className="p-3 text-xs text-muted">Could not refresh. Reconnect to check new messages.</p>}{data.items.map(item=><Link key={item.kind+item.id} href={item.kind==='support'?`/support?device=${item.device_id}#support-${item.id}`:`/messages#reply-${item.id}`} onClick={()=>setOpen(false)} className="flex gap-3 border-b border-line p-3 hover:bg-panel">{item.kind==='support'?<MessageCircle size={16} className="mt-1 shrink-0 text-brand-500"/>:<Mail size={16} className="mt-1 shrink-0 text-brand-500"/>}<div className="min-w-0"><p className="text-xs font-semibold">{item.title} · {item.name||'Student'}</p><p className="mt-1 line-clamp-2 text-xs text-muted">{item.preview}</p><time className="mt-1 block text-[10px] text-muted">{new Date(item.created_at).toLocaleString()}</time></div></Link>)}{!data.items.length&&!failed&&<p className="p-5 text-center text-xs text-muted">You’re all caught up.</p>}</div></section>}
  </div>;
}
