"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef } from "react";
import { LoaderCircle } from "lucide-react";

function PendingHint(){const {pending}=useLinkStatus();return <span data-navigation-pending={pending?'true':'false'} role="status" className={`ml-auto inline-flex size-3.5 shrink-0 ${pending?'opacity-100':'opacity-0'}`}><LoaderCircle aria-hidden="true" className="animate-spin" size={13}/><span className="sr-only">{pending?'Loading page':''}</span></span>;}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  const router=useRouter(),prefetchedAt=useRef(0);
  function prefetch(){if(Date.now()-prefetchedAt.current>30_000){prefetchedAt.current=Date.now();router.prefetch(href);}}
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={prefetch} onFocus={prefetch}
      aria-current={active?"page":undefined}
      className="nav-link"
    >
      {children}
      <PendingHint/>
    </Link>
  );
}
