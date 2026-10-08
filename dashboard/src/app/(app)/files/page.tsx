import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { PushToSchool } from "./push-to-school";

export const metadata: Metadata = { title: "Files" };

export default async function FilesPage() {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="Files" description="Add a school first." />;
  if (!canManage(staff, school.id)) redirect("/devices");

  return (
    <>
      <PageHeader title="Files"
        description="Send a document, video or worksheet to every Primebook. To browse one device's files, open it and choose Files." />
      <div className="card p-4"><PushToSchool schoolId={school.id} /></div>
    </>
  );
}
