"use client";
import { useState } from "react";
export type SchoolClass={id?:string;form_level:string;class_name:string};
export function ClassSelect({groups,formLevel='',className='',prefix=''}:{groups:SchoolClass[];formLevel?:string;className?:string;prefix?:string}) {
 const [form,setForm]=useState(formLevel),[klass,setClass]=useState(className);
 const forms=[...new Set([...groups.map(g=>g.form_level),...(formLevel?[formLevel]:[])])].sort();
 const classes=[...new Set([...groups.filter(g=>g.form_level===form).map(g=>g.class_name).filter(Boolean),...(form===formLevel&&className?[className]:[])])].sort();
 return <><label className="label">{prefix}Form<select name="form_level" value={form} onChange={e=>{setForm(e.target.value);setClass('')}} className="input mt-1"><option value="">Choose form</option>{forms.map(v=><option key={v}>{v}</option>)}</select></label><label className="label">{prefix}Class<select name="class_name" value={klass} onChange={e=>setClass(e.target.value)} className="input mt-1"><option value="">Choose class</option>{classes.map(v=><option key={v}>{v}</option>)}</select></label></>;
}
