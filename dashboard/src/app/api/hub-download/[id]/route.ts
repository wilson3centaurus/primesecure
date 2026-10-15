import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Sign one approved library object on demand; never presign every APK/document on navigation. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  await requireStaff();
  const {id}=await params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return NextResponse.json({error:"File not found"},{status:404});
  const db=await createClient();
  const {data:item,error}=await db.from("hub_items").select("id,storage_path").eq("id",id).maybeSingle();
  if(error||!item)return NextResponse.json({error:"File not found or unavailable"},{status:404});
  // Both the item lookup and storage signing use the user's RLS-scoped session.
  const {data,error:signError}=await db.storage.from("primesecure-hub").createSignedUrl(item.storage_path,180);
  if(signError||!data?.signedUrl)return NextResponse.json({error:"This file could not be opened. Please try again."},{status:503});
  const response=NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control","private, no-store");
  return response;
}
