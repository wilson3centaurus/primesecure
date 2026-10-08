"use client";

import { switchSchool } from "@/app/(app)/actions";
import type { School } from "@/lib/types";

export function SchoolSwitcher({ schools, currentId }: { schools: School[]; currentId: string | null }) {
  return (
    <form action={switchSchool}>
      <label htmlFor="school_id" className="mb-1 block text-xs font-medium tracking-wide text-slate-400 uppercase">
        School
      </label>
      <select
        id="school_id"
        name="school_id"
        defaultValue={currentId ?? ""}
        className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
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
