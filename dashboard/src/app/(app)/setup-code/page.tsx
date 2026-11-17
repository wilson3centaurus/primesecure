import { PageHeader } from "@/components/page-header";
import { canManage, getCurrentSchool, requireStaff } from "@/lib/auth";
import { SetupCodeForm } from "../devices/setup-code-form";

export const metadata = { title: "PrimeBook setup code" };

export default async function SetupCodePage() {
  const [staff, school] = await Promise.all([requireStaff(), getCurrentSchool()]);
  const allowed = !!school && canManage(staff, school.id);

  return <>
    <PageHeader
      title="PrimeBook setup code"
      description="Issue a short-lived, one-device code for the PrimeOS first-boot screen."
    />
    <section className="card mx-auto max-w-xl p-5 sm:p-7">
      {allowed ? <>
        <ol className="mb-5 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>Connect the PrimeBook to Wi-Fi and open <b>Verify your PrimeBook</b>.</li>
          <li>Tap the button below and enter the six digits shown.</li>
          <li>Use the code on one PrimeBook within 15 minutes. It cannot be reused.</li>
        </ol>
        <SetupCodeForm />
        <p className="mt-5 text-xs leading-5 text-muted">On a phone, use your browser&apos;s <b>Add to Home screen</b> option for quick administrator access. Your normal PrimeSecure sign-in and school permissions still apply.</p>
      </> : <p className="text-sm text-red-700">Only a school administrator can issue first-boot setup codes.</p>}
    </section>
  </>;
}
