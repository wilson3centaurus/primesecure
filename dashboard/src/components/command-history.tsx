"use client";

import { useActionState } from "react";
import { cancelCommand } from "@/app/(app)/commands/actions";
import { FormMessage } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { COMMAND_LABEL, COMMAND_STATUS_LABEL, COMMAND_STATUS_STYLE, commandSummary } from "@/lib/commands";
import type { Command } from "@/lib/types";

type Row = Command & { sender: string | null; when: string };

function CancelButton({ id }: { id: string }) {
  const [state, action] = useActionState(cancelCommand, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton className="text-xs text-slate-500 underline" pending="…">Cancel</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function CommandHistory({ commands, canCancel }: { commands: Row[]; canCancel: boolean }) {
  if (commands.length === 0) return <p className="text-sm text-slate-500">Nothing sent yet.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {commands.map((c) => {
        const error = typeof c.result?.error === "string" ? c.result.error : null;
        return (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{COMMAND_LABEL[c.type]}</div>
              {commandSummary(c.type, c.payload) && <div className="truncate text-slate-600">{commandSummary(c.type, c.payload)}</div>}
              {error && <div className="text-red-600">{error}</div>}
              <div className="text-xs text-slate-400">{c.when}{c.sender && ` · ${c.sender}`}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${COMMAND_STATUS_STYLE[c.status]}`}>{COMMAND_STATUS_LABEL[c.status]}</span>
              {canCancel && c.status === "pending" && <CancelButton id={c.id} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
