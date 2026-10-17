import { PrimeMediaLibrary } from '@/components/prime-media-library';
import { AppRequests } from "@/components/app-requests";
import { HubLibrary } from "@/components/hub-library";
import { SectionTabs } from "@/components/section-tabs";
import { DeviceInventories } from "@/components/device-inventories";
import { PushToSchool } from "../files/push-to-school";
import { canManage,getCurrentSchool,requireStaff } from "@/lib/auth";
export default async function LibraryPage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const staff=await requireStaff(),school=await getCurrentSchool();const {tab="notes"}=await searchParams;
 const manager=!!school&&canManage(staff,school.id);
 const tabs=[{id:"notes",label:"School notes"},{id:"prime-media",label:"Prime Media"},{id:"requests",label:"Learning requests"},{id:"wallpapers",label:"Wallpapers"},...(manager?[{id:"devices",label:"Device media"},{id:"transfers",label:"File transfers"}]:[])];
 const current=tabs.some(t=>t.id===tab)?tab:"notes";
 return <><SectionTabs base="/library" current={current} tabs={tabs}/>{current==="notes"?<HubLibrary kind="resource"/>:current==="prime-media"?<PrimeMediaLibrary/>:current==="requests"?<AppRequests kind="resource"/>:current==="wallpapers"?<HubLibrary kind="wallpaper"/>:current==="devices"?<DeviceInventories/>:school&&<section className="card p-5"><h1 className="mb-2 text-lg font-semibold">Quick file transfer</h1><p className="mb-5 text-sm text-slate-500">Send a one-off file to device Downloads. Publish textbooks and class resources in School notes instead.</p><PushToSchool schoolId={school.id}/></section>}</>;
}
