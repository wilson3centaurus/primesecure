"use client";
import { useActionState } from "react";
import { saveSchoolClass, deleteSchoolGroup } from "@/app/(app)/settings/actions";
import { Trash2 } from "lucide-react";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import type { SchoolClass } from "./class-select";
export function SchoolClassSettings({groups}:{groups:SchoolClass[]}) {
 const [state,action]=useActionState(saveSchoolClass,undefined);
 const forms=[...new Set(groups.map(g=>g.form_level))].sort();
 return <section className="card mb-6 p-5"><h2 className="font-semibold">Forms & classes</h2><p className="my-3 text-xs text-muted">Create groups for the dropdown menus. Move assigned students before deleting a form or class. Learning resources are kept.</p><div className="mb-5 divide-y divide-line rounded-lg border border-line">{forms.map(level=><div key={level} className="p-3"><div className="flex items-center justify-between gap-3"><b className="text-sm">{level}</b><DeleteGroup level={level}/></div><div className="mt-2 flex flex-wrap gap-2">{groups.filter(g=>g.form_level===level&&g.class_name).map(g=><div key={g.id||g.class_name} className="flex items-center gap-2 rounded-lg bg-panel px-2 py-1 text-xs"><span>{g.class_name}</span><DeleteGroup level={level} klass={g.class_name}/></div>)}</div></div>)}</div><form action={action} className="grid gap-4 sm:grid-cols-3"><label className="label">Existing form<select name="existing_form" className="input mt-1"><option value="">Create a new form below</option>{forms.map(f=><option key={f}>{f}</option>)}</select></label><label className="label">New form name<input name="new_form" className="input mt-1" maxLength={80} placeholder="e.g. Lower Sixth"/></label><label className="label">Class name (optional)<input name="class_name" className="input mt-1" maxLength={80} placeholder="e.g. 3A"/></label><div className="flex items-center gap-4 sm:col-span-3"><SubmitButton>Add form / class</SubmitButton><FormMessage state={state}/></div></form></section>;
}
function DeleteGroup({level,klass}:{level:string;klass?:string}) {
 const [state,action]=useActionState(deleteSchoolGroup,undefined);
 return <form action={action}><input type="hidden" name="form_level" value={level}/>{klass!==undefined&&<input type="hidden" name="class_name" value={klass}/>}<SubmitButton className="inline-flex items-center gap-1 rounded-md p-1.5 text-xs text-muted hover:text-red-600" confirm={`Delete ${level}${klass?` / ${klass}`:' and all its classes'}? Assigned students must be moved first.`}><Trash2 size={13}/><span className={klass===undefined?'':'sr-only'}>Delete {klass||'form'}</span></SubmitButton><FormMessage state={state}/></form>;
}
