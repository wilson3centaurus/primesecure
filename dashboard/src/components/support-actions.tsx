'use client';
import { useActionState } from 'react';
import { Trash2 } from 'lucide-react';
import { deleteSupportMessage,updateBugStatus } from '@/app/(app)/support/actions';
import { SubmitButton } from './submit-button';
import { FormMessage } from './form-message';
export function SupportActions({id,bug,status}:{id:string;bug:boolean;status:string}) {
 const [deleted,remove]=useActionState(deleteSupportMessage,undefined),[updated,update]=useActionState(updateBugStatus,undefined);
 return <div className="mt-3 flex flex-wrap items-center gap-3">{bug&&<form action={update} className="flex items-center gap-2"><input type="hidden" name="id" value={id}/><select name="status" aria-label="Bug report status" defaultValue={status} className="input text-xs"><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option></select><SubmitButton className="btn-secondary">Update</SubmitButton><FormMessage state={updated}/></form>}<form action={remove}><input type="hidden" name="id" value={id}/><SubmitButton className="icon-button text-muted" confirm="Delete this message and its attachment for both sides? Student copies update after sync."><Trash2 size={14}/><span className="sr-only">Delete support message</span></SubmitButton><FormMessage state={deleted}/></form></div>;
}
