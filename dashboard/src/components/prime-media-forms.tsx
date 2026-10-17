"use client";
import {useActionState} from 'react';
import {addPrimeVideo,savePrimeMedia} from '@/app/(app)/library/media-actions';
import {MEDIA_CATEGORIES} from '@/lib/prime-media';
import {FormMessage} from './form-message';
import {SubmitButton} from './submit-button';
export function PrimeMediaSettings({settings,keyReady}:{settings:{enabled:boolean;youtube_search:boolean;channels:{id:string;name:string}[]}|null;keyReady:boolean}){
 const [state,action]=useActionState(savePrimeMedia,undefined);
 return <form action={action} className="space-y-3"><label className="flex gap-2 text-xs"><input type="checkbox" name="enabled" defaultChecked={settings?.enabled??true}/>Enable Prime Media</label><label className="flex gap-2 text-xs"><input type="checkbox" name="youtube_search" defaultChecked={settings?.youtube_search??false}/>Allow YouTube search (Strict SafeSearch)</label><p className="text-xs text-muted">Search connection: {keyReady?'Configured':'API key needed'}. Approved videos and uploaded files work independently of search. SafeSearch is a filter, not a guarantee of suitability; use approved channels for tighter control.</p><label className="label">Search channels<textarea name="channels" rows={3} className="input mt-1 font-mono text-xs" defaultValue={(settings?.channels||[]).map(c=>`${c.id} | ${c.name}`).join('\n')} placeholder="UC channel ID | Channel name"/></label><p className="text-[11px] text-muted">One per line. With channels listed, students must select one. An empty list permits searches across YouTube when search is enabled.</p><SubmitButton>Save media controls</SubmitButton><FormMessage state={state}/></form>;
}
export function PrimeVideoForm(){
 const [state,action]=useActionState(addPrimeVideo,undefined);
 return <form action={action} className="grid gap-3 sm:grid-cols-2"><label className="label sm:col-span-2">YouTube link<input name="url" type="url" required className="input mt-1" placeholder="https://www.youtube.com/watch?v=…"/></label><label className="label">Title<input name="title" required maxLength={160} className="input mt-1"/></label><label className="label">Creator / channel<input name="channel" maxLength={160} className="input mt-1"/></label><label className="label">Category<select name="category" className="input mt-1">{MEDIA_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label><div className="sm:col-span-2 flex flex-wrap items-center gap-3"><SubmitButton>Add video</SubmitButton><FormMessage state={state}/></div></form>;
}
export function RemovePrimeVideo({id}:{id:string}){
 const [state,action]=useActionState(addPrimeVideo,undefined);
 return <form action={action}><input name="id" type="hidden" value={id}/><input name="action" type="hidden" value="delete"/><SubmitButton className="btn-secondary">Remove</SubmitButton><FormMessage state={state}/></form>;
}
