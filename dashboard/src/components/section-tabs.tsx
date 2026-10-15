import Link from "next/link";
export function SectionTabs({base,current,tabs}:{base:string;current:string;tabs:{id:string;label:string}[]}) {
  return <nav aria-label="Page sections" className="section-tabs">{tabs.map(tab=><Link key={tab.id} href={`${base}?tab=${tab.id}`} aria-current={current===tab.id?"page":undefined}>{tab.label}</Link>)}</nav>;
}
