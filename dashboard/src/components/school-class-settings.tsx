"use client";
import { useActionState } from "react";
import { saveSchoolClass } from "@/app/(app)/settings/actions";
import { FormMessage } from "./form-message";
import { SubmitButton } from "./submit-button";
import type { SchoolClass } from "./class-select";
export function SchoolClassSettings({groups}:{groups:SchoolClass[]}) {
 const [state,action]=useActionState(saveSchoolClass,undefined);
 const forms=[...new Set(groups.map(g=>g.form_level))].sort();
 return <section className="card mb-6 p-6"><h2 className="text-lg font-semibold">Forms & classes</h2><p className="my-3 text-sm text-slate-500">Create the forms and classes your school uses. They appear in student and resource dropdown menus.</p><div className="mb-5 flex flex-wrap gap-2">{groups.map(g=><span key={g.id||g.form_level+g.class_name} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700">{g.form_level}{g.class_name?` · ${g.class_name}`:''}</span>)}</div><form action={action} className="grid gap-4 sm:grid-cols-3"><label className="label">Existing form<select name="existing_form" className="input mt-1"><option value="">Create a new form below</option>{forms.map(f=><option key={f}>{f}</option>)}</select></label><label className="label">New form name<input name="new_form" className="input mt-1" maxLength={80} placeholder="e.g. Lower Sixth"/></label><label className="label">Class name (optional)<input name="class_name" className="input mt-1" maxLength={80} placeholder="e.g. 3A"/></label><div className="flex items-center gap-4 sm:col-span-3"><SubmitButton>Add form / class</SubmitButton><FormMessage state={state}/></div></form></section>;
}
