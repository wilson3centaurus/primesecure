"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// Re-renders the page when rows change. Realtime applies RLS per subscriber,
// so staff only hear about their own school's rows.
export function RealtimeRefresh({ table, filter }: { table: "devices" | "commands" | "policies"; filter?: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`refresh:${table}:${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 500);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, table, filter]);
  return null;
}
