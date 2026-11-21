import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { SupportReply } from "@/components/support-reply";
import { SupportActions } from "@/components/support-actions";
import { ReadMessages } from "@/components/notification-bell";
import { dateTime } from "@/lib/format";
import Link from "next/link";
import Image from "next/image";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { OnlineDot } from "@/components/badges";
import { Check, CheckCheck, MessageCircle, Pin, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";

type Student = { id: string; student_name: string; student_id: string; last_seen_at: string | null; form_level: string | null; class_name: string | null };
type StudentRecord = { device_id: string; username: string; profile_photo: string | null };

function safePhoto(value: unknown) {
  return typeof value === "string" && value.length <= 100000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

function Avatar({ record, label, size = "h-11 w-11" }: { record?: StudentRecord; label: string; size?: string }) {
  const photo = safePhoto(record?.profile_photo);
  return <span className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700`}>
    {photo ? <Image unoptimized src={photo} alt={`${record?.username || label} profile`} width={96} height={96} className="h-full w-full object-cover" /> : (record?.username || label || "S").slice(0, 1).toUpperCase()}
  </span>;
}

function StudentClass({ student }: { student: Student }) {
  const value = [student.form_level, student.class_name].filter(Boolean).join(" · ");
  return value ? <span>{value}</span> : <span>Class not set</span>;
}

function DeliveryMark({ read }: { read: boolean }) {
  const Icon = read ? CheckCheck : Check;
  return <Icon aria-label={read ? "Read" : "Delivered"} className={`h-3.5 w-3.5 ${read ? "text-sky-500" : "text-slate-400"}`} />;
}

function SupportPhoto({ data }: { data: unknown }) {
  const photo = safePhoto(data);
  if (!photo) return null;
  return <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-700">View shared image</summary><Image unoptimized src={photo} alt="Image shared in this support conversation" width={640} height={480} className="mt-2 h-auto max-h-96 w-full max-w-xl rounded-lg object-contain" /></details>;
}

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ device?: string; peer?: string; q?: string }> }) {
  const staff = await requireStaff(), school = await getCurrentSchool();
  if (!school) return <p>Select a school first.</p>;
  if (!canManage(staff, school.id)) redirect("/overview");
  const db = await createClient();
  const chatDb = db.schema("primesecure");
  const { device, peer, q = "" } = await searchParams;
  const { data: devices, error: devicesError } = await db.from("devices")
    .select("id,student_name,student_id,last_seen_at,form_level,class_name").eq("school_id", school.id).order("student_name").limit(2000);
  const students = (devices || []) as Student[];
  const ids = students.map((student) => student.id);
  const { data: profileRows } = ids.length ? await db.from("student_records").select("device_id,username,profile_photo").in("device_id", ids) : { data: [] };
  const records = new Map(((profileRows || []) as StudentRecord[]).map((record) => [record.device_id, record]));
  const filtered = q.trim() ? students.filter((student) => `${student.student_name} ${student.student_id} ${records.get(student.id)?.username || ""}`.toLowerCase().includes(q.trim().toLowerCase())) : students;
  const selected = students.find((student) => student.id === device) || null;

  const [{ data: reads }, { data: recentSupport }] = await Promise.all([
    db.from("communication_receipts").select("message_id").eq("kind", "support"),
    db.from("support_messages").select("*").eq("school_id", school.id).order("created_at", { ascending: false }).limit(selected ? 1 : 100),
  ]);
  const readIds = new Set((reads || []).map((row) => row.message_id));
  const supportResult = selected ? await db.from("support_messages").select("*").eq("device_id", selected.id).order("created_at").limit(300) : { data: recentSupport, error: null };
  const supportMessages = supportResult.data || [];

  let requests: Array<Record<string, unknown>> = [], contacts: Array<Record<string, unknown>> = [], blocks: Array<Record<string, unknown>> = [];
  let preferences: Array<Record<string, unknown>> = [], peerMessages: Array<Record<string, unknown>> = [];
  if (selected) {
    const [requestResult, contactResult, blockResult] = await Promise.all([
      chatDb.from("student_friend_requests").select("*").eq("school_id", school.id).or(`requester_device_id.eq.${selected.id},recipient_device_id.eq.${selected.id}`).order("created_at", { ascending: false }).limit(300),
      chatDb.from("student_contacts").select("*").eq("school_id", school.id).or(`device_low_id.eq.${selected.id},device_high_id.eq.${selected.id}`).order("created_at", { ascending: false }).limit(300),
      chatDb.from("student_blocks").select("*").eq("school_id", school.id).or(`blocker_device_id.eq.${selected.id},blocked_device_id.eq.${selected.id}`).order("created_at", { ascending: false }).limit(300),
    ]);
    requests = requestResult.data || [];
    contacts = contactResult.data || [];
    blocks = blockResult.data || [];
    const contactIds = contacts.map((contact) => String(contact.id));
    if (contactIds.length) preferences = (await chatDb.from("student_contact_preferences").select("*").in("contact_id", contactIds)).data || [];
    const chosen = contacts.find((contact) => {
      const other = contact.device_low_id === selected.id ? contact.device_high_id : contact.device_low_id;
      return other === peer;
    });
    if (chosen) peerMessages = (await chatDb.from("student_chat_messages").select("*").eq("contact_id", chosen.id).order("created_at").limit(1000)).data || [];
  }

  const selectedRecord = selected ? records.get(selected.id) : undefined;
  const friendRows = selected ? contacts.map((contact) => {
    const otherId = String(contact.device_low_id === selected.id ? contact.device_high_id : contact.device_low_id);
    const other = students.find((student) => student.id === otherId);
    const ownPreference = preferences.find((item) => item.contact_id === contact.id && item.owner_device_id === selected.id);
    const blocked = blocks.some((item) => (item.blocker_device_id === selected.id && item.blocked_device_id === otherId) || (item.blocker_device_id === otherId && item.blocked_device_id === selected.id));
    return { contact, otherId, other, record: records.get(otherId), ownPreference, blocked };
  }) : [];
  const chosenFriend = friendRows.find((row) => row.otherId === peer);

  return <>
    <RealtimeRefresh table="support_messages" filter={`school_id=eq.${school.id}`} sound />
    <RealtimeRefresh table="student_friend_requests" filter={`school_id=eq.${school.id}`} schema="primesecure" />
    <RealtimeRefresh table="student_contacts" filter={`school_id=eq.${school.id}`} schema="primesecure" />
    <RealtimeRefresh table="student_blocks" filter={`school_id=eq.${school.id}`} schema="primesecure" />
    <RealtimeRefresh table="student_chat_messages" filter={`school_id=eq.${school.id}`} schema="primesecure" />
    <PageHeader title="Student chat & support" description="Support inbox, friendships and school-authorised conversation oversight." />
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><b>School oversight:</b> student-to-student chat is not private from authorised school administrators. Peer chat is text-only; images remain limited to the RoboKorda support conversation.</div>
    {devicesError && <p role="alert">{devicesError.message}</p>}
    <div className="grid h-[min(760px,calc(100vh-190px))] min-h-[620px] overflow-hidden rounded-2xl border border-line bg-panel xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-b border-line bg-slate-50/70 xl:border-b-0 xl:border-r">
        <div className="border-b border-line p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Students</h2><span className="rounded-full bg-brand-100 px-2 py-1 text-xs text-brand-700">{students.length}</span></div>
          <form className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><input name="q" defaultValue={q} className="input pl-9" placeholder="Search name or username" /><button className="sr-only">Search</button></form>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2" aria-label="Student conversations">
          {filtered.map((student) => { const record = records.get(student.id); const active = selected?.id === student.id; return <Link key={student.id} href={`/support?device=${student.id}`} className={`mb-1 flex items-center gap-3 rounded-xl p-3 transition ${active ? "bg-brand-100" : "hover:bg-white"}`}>
            <Avatar record={record} label={student.student_name} /><span className="min-w-0 flex-1"><b className="block truncate text-sm">{record?.username ? `@${record.username}` : student.student_name}</b><small className="block truncate text-muted">{record?.username ? student.student_name : "Profile username not set"} · <StudentClass student={student} /></small></span><span className="shrink-0 text-[10px]"><OnlineDot device={student} /></span>
          </Link>; })}
          {!filtered.length && <p className="p-5 text-center text-sm text-muted">No matching students.</p>}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 overflow-hidden">
        {!selected ? <section className="p-5"><div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-brand-50 p-4"><UsersRound className="mb-3 h-5 w-5 text-brand-700" /><b className="text-2xl">{students.length}</b><p className="text-xs text-muted">student profiles</p></div><div className="rounded-xl bg-emerald-50 p-4"><ShieldCheck className="mb-3 h-5 w-5 text-emerald-700" /><b className="text-2xl">Internal</b><p className="text-xs text-muted">school-scoped directory</p></div><div className="rounded-xl bg-violet-50 p-4"><MessageCircle className="mb-3 h-5 w-5 text-violet-700" /><b className="text-2xl">Text only</b><p className="text-xs text-muted">between students</p></div></div>
          <h2 className="mb-3 font-semibold">Recent support activity</h2>{[...supportMessages].reverse().map((message) => { const student = students.find((item) => item.id === message.device_id); return <Link href={`/support?device=${message.device_id}`} key={message.id} className="mb-2 flex items-center gap-3 rounded-xl border border-line p-3 hover:bg-slate-50"><Avatar record={records.get(message.device_id)} label={student?.student_name || "S"} size="h-9 w-9" /><span className="min-w-0 flex-1"><b className="block truncate text-sm">{student?.student_name || "Student"}</b><span className="block truncate text-xs text-muted">{message.body}</span></span>{message.sender === "student" && !readIds.has(message.id) && <span className="rounded-full bg-brand-600 px-2 py-1 text-[10px] text-white">New</span>}</Link>; })}
        </section> : <>
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-4"><Avatar record={selectedRecord} label={selected.student_name} /><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{selectedRecord?.username ? `@${selectedRecord.username}` : selected.student_name}</h2><p className="text-xs text-muted">{selected.student_name} · {selected.student_id} · <StudentClass student={selected} /></p><OnlineDot device={selected} /></div><Link href={`/devices/${selected.id}`} className="btn-secondary">Open student record</Link></header>
          <div className="grid h-[calc(100%-78px)] min-h-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="flex min-h-0 min-w-0 flex-col p-5">
              {chosenFriend ? <><div className="mb-4 flex shrink-0 items-center gap-3 rounded-xl bg-slate-50 p-3"><Avatar record={chosenFriend.record} label={chosenFriend.other?.student_name || "S"} size="h-10 w-10" /><div className="flex-1"><b>Monitored conversation with @{chosenFriend.record?.username || "student"}</b><p className="text-xs text-muted">Read-only school audit view · {peerMessages.length} loaded messages</p>{chosenFriend.other ? <OnlineDot device={chosenFriend.other} /> : null}</div><Link href={`/support?device=${selected.id}`} className="btn-secondary">Back to support</Link></div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-[#efeae2] p-4">{peerMessages.map((message) => { const mine = message.sender_device_id === selected.id; return <article key={String(message.id)} className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[78%] rounded-xl px-3 py-2 shadow-sm ${mine ? "bg-[#d9fdd3]" : "bg-white"}`}><p className="whitespace-pre-wrap text-sm">{String(message.body)}</p><div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted"><time>{dateTime(String(message.created_at))}</time>{mine ? <DeliveryMark read={Boolean(message.read_at)} /> : null}</div></div></article>; })}{!peerMessages.length && <p className="p-8 text-center text-sm text-muted">No messages in this friendship yet.</p>}</div>
              </> : <><div className="mb-3 flex shrink-0 items-center gap-2"><span className="relative grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-brand-700"><ShieldCheck className="h-5 w-5" /><i aria-label="Online" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500" /></span><div><h3 className="font-semibold">RoboKorda system admin</h3><p className="text-xs text-emerald-700">Online · pinned support conversation · media permitted</p></div></div>
                <ReadMessages kind="support" ids={supportMessages.filter((message) => message.sender === "student" && !message.deleted_at && !readIds.has(message.id)).map((message) => message.id)} />
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-[#efeae2] p-4">{supportMessages.map((message) => { const details = message.report_details || {}; return <article id={`support-${message.id}`} key={message.id} className={`mb-2 flex ${message.sender === "support" ? "justify-end" : "justify-start"}`}><div className={`max-w-[82%] rounded-xl px-3 py-2 shadow-sm ${message.sender === "support" ? "bg-[#d9fdd3]" : "bg-white"}`}><p className="whitespace-pre-wrap text-sm">{message.body}</p><SupportPhoto data={message.attachment_data} />{message.category === "bug_report" && !message.deleted_at && <details className="mt-2 text-xs"><summary className="cursor-pointer text-brand-700">Bug report details</summary><p className="mt-2 whitespace-pre-wrap">{details.steps}</p></details>}<div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted"><time>{dateTime(message.created_at)}</time>{message.sender === "support" ? <DeliveryMark read={readIds.has(message.id)} /> : null}</div>{!message.deleted_at && <SupportActions id={message.id} bug={message.category === "bug_report"} status={message.report_status} />}</div></article>; })}{!supportMessages.length && <p className="p-8 text-center text-sm text-muted">No support messages yet.</p>}</div><SupportReply key={selected.id} deviceId={selected.id} /></>}
            </section>
            <aside className="min-h-0 overflow-y-auto overscroll-contain border-t border-line bg-slate-50/70 p-4 lg:border-l lg:border-t-0"><section className="mb-5"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><UsersRound className="h-4 w-4" /> Friends ({friendRows.length})</h3>{friendRows.map((row) => <Link key={String(row.contact.id)} href={`/support?device=${selected.id}&peer=${row.otherId}`} className={`mb-2 flex items-center gap-2 rounded-xl border p-2 ${peer === row.otherId ? "border-brand-400 bg-brand-50" : "border-line bg-white"}`}><Avatar record={row.record} label={row.other?.student_name || "S"} size="h-9 w-9" /><span className="min-w-0 flex-1"><b className="block truncate text-xs">@{row.record?.username || "student"}</b><small className="text-muted">{row.blocked ? "Blocked" : String(row.ownPreference?.friend_tag || "Friend")}</small>{row.other ? <OnlineDot device={row.other} /> : null}</span>{Boolean(row.ownPreference?.pinned) && <Pin className="h-3 w-3 text-brand-700" />}</Link>)}{!friendRows.length && <p className="text-xs text-muted">No accepted friends.</p>}</section>
              <section className="mb-5"><h3 className="mb-2 text-sm font-semibold">Friend requests ({requests.length})</h3><div className="max-h-56 space-y-2 overflow-y-auto">{requests.map((request) => { const outgoing = request.requester_device_id === selected.id; const otherId = String(outgoing ? request.recipient_device_id : request.requester_device_id); return <div key={String(request.id)} className="rounded-lg border border-line bg-white p-2 text-xs"><b>{outgoing ? "Sent to" : "Received from"} @{records.get(otherId)?.username || "student"}</b><p className="mt-1 capitalize text-muted">{String(request.status)} · {dateTime(String(request.responded_at || request.created_at))}</p></div>; })}{!requests.length && <p className="text-xs text-muted">No request history.</p>}</div></section>
              <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><UserRound className="h-4 w-4" /> Blocking ({blocks.length})</h3>{blocks.map((block) => { const studentBlocked = block.blocker_device_id === selected.id; const otherId = String(studentBlocked ? block.blocked_device_id : block.blocker_device_id); return <p key={`${block.blocker_device_id}:${block.blocked_device_id}`} className="mb-2 rounded-lg border border-line bg-white p-2 text-xs"><b>@{records.get(otherId)?.username || "student"}</b><span className="block text-muted">{studentBlocked ? "Blocked by this student" : "Blocked this student"}</span></p>; })}{!blocks.length && <p className="text-xs text-muted">No blocks involving this student.</p>}</section>
            </aside>
          </div>
        </>}
      </main>
    </div>
  </>;
}
