import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PolicyEditor } from "@/components/policy-editor";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { getPolicy } from "@/lib/policy";

export const metadata: Metadata = { title: "School policy" };

export default async function SchoolPolicyPage() {
  const staff = await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return <PageHeader title="School policy" description="Add a school first." />;
  const policy = await getPolicy(school.id, null);

  return (
    <>
      <PageHeader title="School policy"
        description={`Applies to every Primebook at ${school.name} unless the device has its own policy.`} />
      <PolicyEditor key={policy?.id ?? "new"} policy={policy} schoolId={school.id} canEdit={canManage(staff, school.id)} />
    </>
  );
}
