"use client";
import { useEffect, useRef, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X, ShieldCheck, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";

const labels:Record<string,string>={overview:"Overview",devices:"Students & devices",messages:"Messages",library:"Content & files",apps:"Apps",support:"Student support",reports:"Usage reports",cases:"Issues & cases",settings:"Settings",staff:"Staff",schools:"Schools",agent:"Agent updates"};
export function WorkspaceShell({sidebar,children,school}:{sidebar:React.ReactNode;children:React.ReactNode;school:string}) {
 const [open,setOpen]=useState(false),[collapsed,setCollapsed]=useState(false);
 const sidebarRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(!open)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const navigation=sidebarRef.current;
  const focusable=()=>Array.from(navigation?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select:not([disabled]),input:not([disabled])')||[]).filter(node=>node.offsetParent!==null);
  focusable()[0]?.focus();
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setOpen(false);return;}
   if(event.key==='Tab'){const nodes=focusable(),first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  };
  document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('keydown',keyboard);previous?.focus();};
 },[open]);
 const page=labels[usePathname().split('/')[1]]||"Workspace";
 return <div className="workspace-shell">
  <a href="#workspace-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
  {open&&<button type="button" className="workspace-overlay" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}
  <aside ref={sidebarRef} id="workspace-navigation" className={`workspace-sidebar${open?' is-open':''}${collapsed&&!open?' is-collapsed':''}`} onClick={event=>{if((event.target as Element).closest('a[href]'))setOpen(false);}}>
   <button type="button" className="icon-button workspace-mobile-menu absolute top-4 right-3" aria-label="Close navigation" onClick={()=>setOpen(false)}><X size={17}/></button>{sidebar}
  </aside>
  <div className="workspace-main" inert={open?true:undefined}><header className="workspace-header">
   <div className="flex min-w-0 items-center gap-3"><button type="button" className="icon-button workspace-mobile-menu" onClick={()=>setOpen(true)} aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={open}><Menu size={17}/></button><button type="button" className="icon-button workspace-desktop-collapse" onClick={()=>setCollapsed(!collapsed)} aria-label={collapsed?'Expand navigation':'Collapse navigation'}>{collapsed?<PanelLeftOpen size={16}/>:<PanelLeftClose size={16}/>}</button><span className="hidden text-xs text-muted sm:inline">Workspace</span><ChevronRight size={12} className="hidden text-muted sm:block"/><span className="truncate text-xs font-semibold">{page}</span></div>
   <div className="flex min-w-0 items-center gap-4"><div className="workspace-header-school hidden min-w-0 items-center gap-2 sm:flex"><ShieldCheck size={15} className="shrink-0 text-emerald-500"/><span className="max-w-64 truncate text-xs text-muted" title={school}>{school}</span></div><NotificationBell/><ThemeToggle/></div>
  </header><main id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</main></div>
 </div>;
}
