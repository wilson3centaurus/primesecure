"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Progress reports do not require a device-row check-in to refresh the dashboard. */
export function SetupProgressRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return null;
}
