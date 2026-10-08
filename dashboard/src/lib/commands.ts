import type { CommandStatus, CommandType } from "@/lib/types";

export const COMMAND_LABEL: Record<CommandType, string> = {
  message: "Message",
  install_apk: "Install app",
  remove_apk: "Remove app",
  push_file: "Push file",
  delete_file: "Delete file",
  list_files: "List files",
  locate: "Locate",
  suspend: "Suspend",
  unsuspend: "Unsuspend",
  lock: "Lock",
  unlock: "Unlock",
  retire: "Retire",
};

export const COMMAND_STATUS_STYLE: Record<CommandStatus, string> = {
  pending: "bg-slate-100 text-slate-600",
  delivered: "bg-blue-50 text-blue-700",
  succeeded: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-400 line-through",
};

export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  pending: "Waiting for device",
  delivered: "Delivered",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

// One line describing what a command carried, for the history list.
export function commandSummary(type: CommandType, payload: Record<string, unknown>): string {
  const s = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  switch (type) {
    case "message": return s("body");
    case "install_apk": return s("name") || s("package");
    case "remove_apk": return s("package");
    case "push_file":
    case "delete_file":
    case "list_files": return s("path") || "/";
    case "lock": return s("message");
    default: return "";
  }
}
