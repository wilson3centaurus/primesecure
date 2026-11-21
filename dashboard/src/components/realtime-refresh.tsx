"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type RealtimeTable =
  | "devices"
  | "commands"
  | "policies"
  | "support_messages"
  | "student_friend_requests"
  | "student_contacts"
  | "student_blocks"
  | "student_chat_messages"
  | "student_chat_presence";

function ding() {
  try {
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audio.currentTime);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.23);
    oscillator.addEventListener("ended", () => void audio.close());
  } catch {
    // Browsers can decline audio until the administrator interacts with the page.
  }
}

// Re-renders the page when rows change. Realtime applies RLS per subscriber,
// so staff only hear about their own school's rows.
export function RealtimeRefresh({ table, filter, sound = false, schema = "public" }: { table: RealtimeTable; filter?: string; sound?: boolean; schema?: "public" | "primesecure" }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`refresh:${schema}:${table}:${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema, table, filter }, (event) => {
        if (sound && event.eventType === "INSERT" && (table !== "support_messages" || event.new.sender === "student")) ding();
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 500);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [router, table, filter, sound, schema]);
  return null;
}
