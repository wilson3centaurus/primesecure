"""Inspect or deploy the reviewed PrimeBook first-boot flow to the school server.

The apply path uploads a hash-pinned bundle. The server script verifies the
backend identity, takes private schema/function backups, applies migrations in
one transaction, restarts only Edge Functions, and runs HTTP health checks.
No Supabase keys or student data are printed or copied to this computer.
"""
import argparse
import hashlib
import json
import shlex
from datetime import datetime, timezone
from pathlib import Path

import paramiko


REPO = Path(__file__).resolve().parents[2]
HOST = "178.238.227.229"
EXPECTED_SCHOOL = "Rusununguko ZIMFEP High School"
PSQL = (
    "docker exec -i supabase-db psql -X -q -A -t "
    "-v ON_ERROR_STOP=1 -U supabase_admin -d postgres"
)
FILES = {
    "deploy-device-setup-server.sh": REPO / "tools/maintenance/deploy-device-setup-server.sh",
    "20261029065844_device_setup_requests.sql": REPO / "supabase/migrations/20261029065844_device_setup_requests.sql",
    "20261103170000_first_boot_setup_codes.sql": REPO / "supabase/migrations/20261103170000_first_boot_setup_codes.sql",
    "20261109164344_primeid_serial_and_student_class.sql": REPO / "supabase/migrations/20261109164344_primeid_serial_and_student_class.sql",
    "device-setup/index.ts": REPO / "supabase/functions/device-setup/index.ts",
    "enroll/index.ts": REPO / "supabase/functions/enroll/index.ts",
}


def run(client: paramiko.SSHClient, command: str, data: str | None = None) -> str:
    stdin, stdout, stderr = client.exec_command(command)
    if data is not None:
        stdin.write(data)
        stdin.flush()
        stdin.channel.shutdown_write()
    output = stdout.read().decode()
    error = stderr.read().decode()
    status = stdout.channel.recv_exit_status()
    if status:
        raise RuntimeError(f"Remote command failed ({status}): {error[-2000:]}")
    return output.strip()


def inspect(client: paramiko.SSHClient) -> dict:
    query = """
select json_build_object(
  'database',current_database(),
  'school',(select name from public.schools where id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),
  'device_setup_requests',to_regclass('public.device_setup_requests') is not null,
  'school_setup_codes',to_regclass('public.school_setup_codes') is not null,
  'first_boot_sessions',to_regclass('public.first_boot_sessions') is not null,
  'device_class_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='devices' and column_name in ('class_form','class_section')),
  'session_class_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='first_boot_sessions' and column_name in ('class_form','class_section')),
  'setup_code_rpc',to_regprocedure('public.staff_issue_school_setup_code(uuid)') is not null
);
"""
    state = json.loads(run(client, PSQL, query))
    if state.get("school") != EXPECTED_SCHOOL:
        raise RuntimeError(f"Backend identity mismatch: {state.get('school')!r}")
    state["database_container"] = run(client, "docker inspect -f '{{.State.Running}}' supabase-db") == "true"
    state["edge_container"] = run(client, "docker inspect -f '{{.State.Running}}' supabase-edge-functions") == "true"
    return state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="upload and execute the reviewed deployment")
    args = parser.parse_args()

    for relative, path in FILES.items():
        if not path.is_file():
            raise FileNotFoundError(f"Missing bundle input {relative}: {path}")

    client = paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home() / ".ssh/known_hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        HOST,
        username="root",
        key_filename=str(Path.home() / ".ssh/primesecure_support_ed25519"),
        timeout=15,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        before = inspect(client)
        reviewed = {
            relative: hashlib.sha256(path.read_bytes()).hexdigest()
            for relative, path in FILES.items()
        }
        print(json.dumps({"before": before, "reviewed_sha256": reviewed}, sort_keys=True), flush=True)
        if not args.apply:
            return

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        remote = f"/root/primesecure-deployments/device-setup-{stamp}"
        run(client, f"install -d -m 700 {shlex.quote(remote)} {shlex.quote(remote + '/device-setup')} {shlex.quote(remote + '/enroll')}")
        with client.open_sftp() as sftp:
            for relative, path in FILES.items():
                destination = f"{remote}/{relative}"
                sftp.put(str(path), destination)
                sftp.chmod(destination, 0o700 if relative.endswith(".sh") else 0o600)
            with sftp.open(f"{remote}/SHA256SUMS", "w") as manifest:
                for relative, digest in reviewed.items():
                    manifest.write(f"{digest}  {relative}\n")
            sftp.chmod(f"{remote}/SHA256SUMS", 0o600)

        result = run(
            client,
            f"cd {shlex.quote(remote)} && ./deploy-device-setup-server.sh",
        )
        after = inspect(client)
        print(json.dumps({"deployment_output": result, "after": after, "bundle": remote}, sort_keys=True), flush=True)
    finally:
        client.close()


if __name__ == "__main__":
    main()
