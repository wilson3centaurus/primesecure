export type AppRole = "super_admin" | "school_admin" | "teacher";
export type DeviceStatus = "pending" | "active" | "suspended" | "locked" | "retired";

export type School = { id: string; name: string; created_at: string };

export type Profile = {
  id: string;
  school_id: string | null;
  role: AppRole;
  full_name: string | null;
  created_at: string;
};

export type Device = {
  id: string;
  school_id: string;
  enroll_token: string | null;
  enroll_token_expires_at: string | null;
  auth_user_id: string | null;
  model: string | null;
  manufacturer: string | null;
  serial: string | null;
  android_id: string | null;
  os_version: string | null;
  agent_version: string | null;
  student_name: string | null;
  student_id: string | null;
  status: DeviceStatus;
  battery_level: number | null;
  battery_charging: boolean | null;
  last_seen_at: string | null;
  last_ip: string | null;
  enrolled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Policy = {
  id: string;
  school_id: string;
  device_id: string | null;
  wallpaper_url: string | null;
  lock_wallpaper: boolean;
  block_installs: boolean;
  hide_settings: boolean;
  hidden_apps: string[];
  allowed_apps: string[];
  updated_at: string;
};

export type CommandType =
  | "message" | "install_apk" | "remove_apk" | "push_file" | "delete_file"
  | "locate" | "suspend" | "unsuspend" | "lock" | "unlock" | "retire";

export type CommandStatus = "pending" | "delivered" | "succeeded" | "failed" | "cancelled";

export type Command = {
  id: string;
  device_id: string;
  school_id: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  result: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  delivered_at: string | null;
  executed_at: string | null;
};

// Shared result shape for form server actions.
export type FormState = { error?: string; ok?: string } | undefined;
