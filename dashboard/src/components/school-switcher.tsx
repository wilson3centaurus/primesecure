"use client";

import { switchSchool } from "@/app/(app)/actions";
import type { School } from "@/lib/types";

export function SchoolSwitcher({ schools, currentId }: { schools: School[]; currentId: string | null }) {
  return (
    <form action={switchSchool}>
      <label htmlFor="school_id" className="mb-1.5 block text-[10px] font-semibold tracking-wide text-muted uppercase">
        School workspace
      </label>
      <select
        id="school_id"
        name="school_id"
        defaultValue={currentId ?? ""}
        className="w-full min-w-0 bg-transparent py-0.5 text-xs font-medium text-ink outline-none"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {schools.length === 0 && <option value="">No schools yet</option>}
        {schools.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </form>
  );
}
