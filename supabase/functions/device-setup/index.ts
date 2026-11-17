// PrimeBook first-boot verification plus compatibility for the earlier approval flow.
// Raw device secrets and six-digit setup codes are never stored in the database.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE=/^\+[1-9][0-9]{7,14}$/;
const SIX=/^[0-9]{6}$/;
const SECTION=/^[A-Z]{1,4}$/;
function reply(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function clean(value:unknown,max:number){return typeof value==="string"&&value.trim()?value.trim().slice(0,max):null}
async function digest(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
function legacyCode(){const n=crypto.getRandomValues(new Uint32Array(1))[0]%1_000_000;return n.toString().padStart(6,"0")}

async function schoolName(schoolId:string){
  const {data}=await admin.from("schools").select("name").eq("id",schoolId).maybeSingle();
  return data?.name??"Assigned school";
}

async function lookupDevice(serial:string|null,prime:string|null){
  const fields="id,school_id,student_name,serial,prime_id,class_form,class_section,status,created_at";
  if(serial){
    const {data,error}=await admin.from("devices").select(fields).eq("serial",serial).order("created_at",{ascending:true}).limit(1).maybeSingle();
    if(error)throw error;if(data)return data;
  }
  if(prime){
    const {data,error}=await admin.from("devices").select(fields).eq("prime_id",prime).maybeSingle();
    if(error)throw error;if(data)return data;
  }
  return null;
}

async function sessionPayload(session:{id:string;school_id:string;device_id:string|null;hardware_id:string},device?:Record<string,unknown>|null){
  const assigned=device??(session.device_id?(await admin.from("devices").select("id,school_id,student_name,serial,prime_id,class_form,class_section,status,created_at").eq("id",session.device_id).maybeSingle()).data:null);
  return {
    session_id:session.id,
    assignment_state:assigned?.student_name?"assigned":"unassigned",
    school_name:await schoolName(session.school_id),
    student_name:assigned?.student_name??null,
    assignment_date:assigned?.created_at??null,
    class_form:assigned?.class_form??null,
    class_section:assigned?.class_section??null,
    hardware_id:session.hardware_id,
  };
}

// Once a setup code has proved the school/device relationship, prepare the
// single-use enrollment token in the same request. The PrimeBook can then show
// the recovered assignment and finish its embedded security work without a
// second "restore assignment" server round-trip.
async function activateVerifiedSession(
  session:{id:string;setup_code_id:string;school_id:string;device_id:string|null;hardware_id:string},
  device:Record<string,any>,
){
  const {data:token,error:tokenError}=await admin.rpc("gen_enroll_token");
  if(tokenError||!token)throw new Error("token_create_failed");
  const expires=new Date(Date.now()+7*86400_000).toISOString();
  const {error:updateError}=await admin.from("devices").update({enroll_token:token,enroll_token_expires_at:expires}).eq("id",device.id);
  if(updateError)throw updateError;
  await admin.from("first_boot_sessions").update({device_id:device.id,status:"activated"}).eq("id",session.id);
  await admin.from("school_setup_codes").update({used_at:new Date().toISOString()}).eq("id",session.setup_code_id);
  return {...await sessionPayload(session,device),enroll_token:token,enroll_token_expires_at:expires};
}

async function verifyFirstBoot(body:Record<string,unknown>,secretHash:string){
  const setupCode=clean(body.setup_code,6),serial=clean(body.serial,200)?.toUpperCase()??null;
  const prime=clean(body.prime_id,200)?.toUpperCase()??null;
  const hardware=clean(body.hardware_id,200)?.toUpperCase()??serial??prime;
  if(!setupCode||!SIX.test(setupCode))return reply(400,{error:"invalid_setup_code"});
  if(prime&&prime.length<3)return reply(400,{error:"invalid_prime_id"});
  if(!hardware||hardware==="IDENTITY PENDING")return reply(400,{error:"identity_unavailable"});

  const {data:existing}=await admin.from("first_boot_sessions")
    .select("id,setup_code_id,school_id,device_id,hardware_id,expires_at").eq("request_secret_hash",secretHash)
    .gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(existing){
    const payload=await sessionPayload(existing);
    if(existing.device_id&&payload.assignment_state==="assigned"){
      const {data:device}=await admin.from("devices").select("id,school_id,student_name,serial,prime_id,class_form,class_section,status,created_at").eq("id",existing.device_id).maybeSingle();
      if(device){try{return reply(200,await activateVerifiedSession(existing,device))}catch{return reply(500,{error:"token_create_failed"})}}
    }
    return reply(200,payload);
  }

  const codeHash=await digest(setupCode);
  const {data:code,error:codeError}=await admin.from("school_setup_codes")
    .select("id,school_id,claimed_secret_hash,claimed_at,expires_at")
    .eq("code_hash",codeHash).is("used_at",null).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(codeError)return reply(500,{error:"setup_code_lookup_failed"});
  if(!code)return reply(404,{error:"unknown_setup_code"});
  const claimFresh=code.claimed_at&&Date.now()-Date.parse(code.claimed_at)<30*60_000;
  if(code.claimed_secret_hash&&code.claimed_secret_hash!==secretHash&&claimFresh)return reply(409,{error:"setup_code_in_use"});

  const {error:claimError}=await admin.from("school_setup_codes").update({claimed_secret_hash:secretHash,claimed_at:new Date().toISOString()}).eq("id",code.id);
  if(claimError)return reply(500,{error:"setup_code_claim_failed"});
  let device;try{device=await lookupDevice(serial,prime)}catch{return reply(500,{error:"device_lookup_failed"})}
  if(device&&device.school_id!==code.school_id)return reply(409,{error:"device_assigned_other_school"});
  const row={request_secret_hash:secretHash,setup_code_id:code.id,school_id:code.school_id,device_id:device?.id??null,
    hardware_id:hardware,serial,prime_id:prime,android_id:clean(body.android_id,200),model:clean(body.model,200),status:device?"assigned":"verified"};
  const {data:session,error}=await admin.from("first_boot_sessions").insert(row).select("id,setup_code_id,school_id,device_id,hardware_id").single();
  if(error)return reply(500,{error:"session_create_failed"});
  if(device){try{return reply(200,await activateVerifiedSession(session,device))}catch{return reply(500,{error:"token_create_failed"})}}
  return reply(200,await sessionPayload(session,device));
}

async function finishFirstBoot(body:Record<string,unknown>,secretHash:string,assign:boolean){
  const id=clean(body.session_id,36);if(!id||!UUID.test(id))return reply(400,{error:"invalid_session"});
  const {data:session,error}=await admin.from("first_boot_sessions")
    .select("id,setup_code_id,school_id,device_id,hardware_id,serial,prime_id,android_id,model,status,expires_at")
    .eq("id",id).eq("request_secret_hash",secretHash).gt("expires_at",new Date().toISOString()).maybeSingle();
  if(error)return reply(500,{error:"session_lookup_failed"});if(!session)return reply(404,{error:"unknown_session"});
  let deviceId=session.device_id as string|null;
  let student:string|null=null;
  if(assign){
    student=clean(body.student_name,160);if(!student||student.length<2)return reply(400,{error:"invalid_student_name"});
    const form=Number(body.class_form),section=clean(body.class_section,4)?.toUpperCase()??null;
    if(!Number.isInteger(form)||form<1||form>6||!section||!SECTION.test(section))return reply(400,{error:"invalid_student_class"});
    if(deviceId)return reply(409,{error:"already_assigned"});
    let existing;try{existing=await lookupDevice(session.serial,session.prime_id)}catch{return reply(500,{error:"device_lookup_failed"})}
    if(existing){
      if(existing.school_id!==session.school_id)return reply(409,{error:"device_assigned_other_school"});
      deviceId=existing.id;student=existing.student_name;
      await admin.from("devices").update({class_form:form,class_section:section}).eq("id",deviceId);
    }else{
      const {data:created,error:createError}=await admin.from("devices").insert({school_id:session.school_id,student_name:student,
        class_form:form,class_section:section,model:session.model,serial:session.serial,android_id:session.android_id,prime_id:session.prime_id}).select("id,student_name").single();
      if(createError)return reply(500,{error:"device_create_failed"});deviceId=created.id;
    }
    await admin.from("first_boot_sessions").update({class_form:form,class_section:section}).eq("id",session.id);
  }
  if(!deviceId)return reply(409,{error:"assignment_required"});
  const {data:device}=await admin.from("devices").select("id,student_name,status").eq("id",deviceId).eq("school_id",session.school_id).maybeSingle();
  if(!device||device.status==="retired")return reply(409,{error:"device_unavailable"});
  const {data:token,error:tokenError}=await admin.rpc("gen_enroll_token");
  if(tokenError||!token)return reply(500,{error:"token_create_failed"});
  const expires=new Date(Date.now()+7*86400_000).toISOString();
  const {error:updateError}=await admin.from("devices").update({enroll_token:token,enroll_token_expires_at:expires,
    serial:session.serial??undefined,prime_id:session.prime_id??undefined,android_id:session.android_id??undefined,model:session.model??undefined}).eq("id",deviceId);
  if(updateError)return reply(500,{error:"token_save_failed"});
  await admin.from("first_boot_sessions").update({device_id:deviceId,student_name:student??device.student_name,status:"activated"}).eq("id",session.id);
  await admin.from("school_setup_codes").update({used_at:new Date().toISOString()}).eq("id",session.setup_code_id).eq("claimed_secret_hash",secretHash);
  return reply(200,{device_id:deviceId,student_name:student??device.student_name,enroll_token:token,expires_at:expires});
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return reply(405,{error:"method_not_allowed"});
  let body:Record<string,unknown>;try{body=await req.json()}catch{return reply(400,{error:"invalid_json"})}
  const secret=clean(body.request_secret,64);if(!secret||!UUID.test(secret))return reply(401,{error:"invalid_request_secret"});
  const secretHash=await digest(secret);const action=clean(body.action,32)??"request";
  if(action==="verify_code")return verifyFirstBoot(body,secretHash);
  if(action==="assign")return finishFirstBoot(body,secretHash,true);
  if(action==="activate")return finishFirstBoot(body,secretHash,false);

  // Compatibility with setup requests already created by earlier pilot APKs.
  if(action==="status"){
    const id=clean(body.request_id,36);if(!id||!UUID.test(id))return reply(400,{error:"invalid_request"});
    const {data:r,error}=await admin.from("device_setup_requests").select("id,status,device_id,student_name,region")
      .eq("id",id).eq("request_secret_hash",secretHash).maybeSingle();
    if(error)return reply(500,{error:"lookup_failed"});if(!r)return reply(404,{error:"unknown_request"});
    let enroll_token:null|string=null,expires_at:null|string=null;
    if(r.status==="approved"&&r.device_id){const {data:d}=await admin.from("devices").select("enroll_token,enroll_token_expires_at").eq("id",r.device_id).maybeSingle();enroll_token=d?.enroll_token??null;expires_at=d?.enroll_token_expires_at??null}
    return reply(200,{...r,enroll_token,expires_at});
  }
  if(action!=="request")return reply(400,{error:"unknown_action"});
  const student=clean(body.student_name,160),region=clean(body.region,80),phone=clean(body.phone,16);
  const school=clean(body.school_id,36),prime=clean(body.prime_id,200)?.toUpperCase()??null;
  if(!student||student.length<2||!region||region.length<2)return reply(400,{error:"invalid_identity"});
  if(!phone||!PHONE.test(phone))return reply(400,{error:"invalid_phone"});
  if(school&&!UUID.test(school))return reply(400,{error:"invalid_school"});if(prime&&prime.length<3)return reply(400,{error:"invalid_prime_id"});
  if(school){const {data:s}=await admin.from("schools").select("id").eq("id",school).maybeSingle();if(!s)return reply(400,{error:"unknown_school"})}
  const {data:open}=await admin.from("device_setup_requests").select("id,status,device_id,verification_code")
    .eq("request_secret_hash",secretHash).in("status",["pending","approved"]).maybeSingle();
  if(open)return reply(200,open);
  const row={request_secret_hash:secretHash,verification_code:legacyCode(),school_id:school,student_name:student,phone_e164:phone,region,
    prime_id:prime,model:clean(body.model,200),serial:clean(body.serial,200),android_id:clean(body.android_id,200)};
  const {data,error}=await admin.from("device_setup_requests").insert(row).select("id,status,device_id,verification_code").single();
  if(error)return reply(500,{error:"request_create_failed"});return reply(201,data);
});
