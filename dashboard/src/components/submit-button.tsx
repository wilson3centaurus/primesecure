"use client";

import { useFormStatus } from "react-dom";
import { useSyncExternalStore } from "react";

const subscribeReady = () => () => {};

export function SubmitButton({
  children,
  pending: pendingLabel,
  className = "btn-primary",
  confirm,
  disabled,
}: {
  children: React.ReactNode;
  pending?: string;
  className?: string;
  confirm?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  // A confirmation exists only after hydration. Prevent the browser's plain
  // pre-hydration POST from bypassing it (or replaying a destructive action).
  const ready = useSyncExternalStore(subscribeReady, () => true, () => false);
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled || Boolean(confirm && !ready)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}
