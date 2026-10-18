"use client";
import { useActionState } from 'react';
import { deleteNotesFolders } from '@/app/(app)/library/actions';
import { SubmitButton } from './submit-button';
import { FormMessage } from './form-message';

export function NotesFolderDelete({paths,shared,onDeleted}:{paths:string[][];shared:boolean;onDeleted:()=>void}){
 const [state,action]=useActionState(async(previous:Parameters<typeof deleteNotesFolders>[0],form:FormData)=>{
  const result=await deleteNotesFolders(previous,form);if(result?.ok)onDeleted();return result;
 },undefined);
 if(!paths.length)return null;
 return <form action={action} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
  <input type="hidden" name="paths" value={JSON.stringify(paths)}/>{shared&&<input type="hidden" name="shared" value="on"/>}
  <SubmitButton className="btn-secondary text-red-700" confirm={`Permanently delete ${paths.length} selected folders and ALL their files and subfolders? ${shared?'Shared originals are deleted for EVERY school.':'This affects this school only.'} This cannot be undone.`}>Delete {paths.length} selected folders and contents</SubmitButton><FormMessage state={state}/>
 </form>;
}
