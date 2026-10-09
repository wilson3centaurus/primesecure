"use client";

import { useFormStatus } from "react-dom";

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
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? "Saving…") : children}
    </button>
  );
}
