import Link from "next/link";
export function SectionTabs({base,current,tabs}:{base:string;current:string;tabs:{id:string;label:string}[]}) {
  return <nav aria-label="Page sections" className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">{tabs.map(tab=><Link key={tab.id} href={`${base}?tab=${tab.id}`} aria-current={current===tab.id?"page":undefined} className={`border-b-2 px-4 py-3 text-sm ${current===tab.id?"border-brand-600 font-semibold text-brand-700":"border-transparent text-slate-500 hover:text-slate-800"}`}>{tab.label}</Link>)}</nav>;
}
