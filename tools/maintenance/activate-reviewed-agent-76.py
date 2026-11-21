#!/usr/bin/env python3
"""Activate only the exact reviewed PrimeSecure code-76 release.

This server-side maintenance tool refuses inserts, storage changes, release
identity drift, and device/command writes.  It takes a table lock, writes
private before/after evidence, changes only ``active`` on version code 76,
and proves every other release row stayed byte-for-byte identical.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import select
import stat
import subprocess
import sys
import uuid


CODE = 76
VERSION = "0.9.44-preload-chat"
SHA = "3996886dab97153ae9564fb66ddcd582fd43e6c2fb048a324fa4ddbac587a17f"
OBJECT = f"releases/{CODE}-{SHA}.apk"
STAGE = Path("/root/primesecure-release-stage")
PSQL = [
    "docker", "exec", "-i", "supabase-db", "psql", "-X", "-q", "-A", "-t",
    "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
]
SNAPSHOT_SQL = """select jsonb_build_object(
 'database',current_database(),
 'school',(select name from public.schools where id='14eea188-73b1-40bc-8f8d-15afbea27ffa'),
 'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by version_code),'[]'::jsonb)
           from public.agent_releases r));"""


class GuardError(ValueError):
    pass


def require(ok, message):
    if not ok:
        raise GuardError(message)


def release(rows):
    matches = [row for row in rows if row["version_code"] == CODE]
    require(len(matches) == 1, "Reviewed release row is missing or duplicated")
    row = matches[0]
    require(
        row["version_name"] == VERSION
        and row["sha256"] == SHA
        and row["storage_path"] == OBJECT,
        "Reviewed release identity differs",
    )
    return row


def private_directory(path):
    require(path.parent == STAGE, "Evidence directory escaped fixed staging root")
    path.mkdir(mode=0o700)
    info = path.lstat()
    require(
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == 0
        and not info.st_mode & 0o077,
        "Evidence directory is not private and root-owned",
    )


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, sort_keys=True, indent=2)
        output.flush()
        os.fsync(output.fileno())


class ReleaseTransaction:
    def __init__(self):
        self.process = subprocess.Popen(
            PSQL,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

    def query(self, sql):
        self.process.stdin.write(sql + "\n")
        self.process.stdin.flush()
        ready, _, _ = select.select([self.process.stdout], [], [], 45)
        require(ready, "Database transaction timed out")
        line = self.process.stdout.readline()
        require(line, "Database transaction failed")
        return json.loads(line)

    def commit(self):
        self.process.stdin.write("commit;\n")
        self.process.stdin.close()
        require(self.process.wait(timeout=45) == 0, "Activation commit failed")

    def close(self):
        if not self.process.stdin.closed:
            self.process.stdin.close()
        if self.process.poll() is None:
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.process.stdout.close()


def activate():
    backup = STAGE / (
        "activate-76-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
    )
    private_directory(backup)
    transaction = ReleaseTransaction()
    try:
        before = transaction.query(
            "begin; set local lock_timeout='10s'; set local statement_timeout='30s'; "
            "set local idle_in_transaction_session_timeout='60s'; "
            "lock table public.agent_releases in share row exclusive mode;\n" + SNAPSHOT_SQL
        )
        require(
            before["database"] == "postgres"
            and before["school"] == "Rusununguko ZIMFEP High School",
            "Backend identity mismatch",
        )
        target_before = release(before["rows"])
        private_json(backup / "before.json", before)
        after = transaction.query(
            "update public.agent_releases set active=true "
            f"where version_code={CODE} and active=false and version_name='{VERSION}' "
            f"and sha256='{SHA}' and storage_path='{OBJECT}';\n" + SNAPSHOT_SQL
        )
        target_after = release(after["rows"])
        before_others = [row for row in before["rows"] if row["version_code"] != CODE]
        after_others = [row for row in after["rows"] if row["version_code"] != CODE]
        expected_target = dict(target_before, active=True)
        require(target_after == expected_target, "Only the reviewed active flag may change")
        require(before_others == after_others, "Another release row changed")
        proof = {
            "operation": "activate-reviewed-code-76",
            "release": target_after,
            "other_rows_unchanged": True,
            "devices_modified": False,
            "commands_modified": False,
        }
        private_json(backup / "verified-before-commit.json", proof)
        transaction.commit()
        private_json(backup / "committed.json", proof)
        return dict(proof, backup=str(backup))
    finally:
        transaction.close()


if __name__ == "__main__":
    try:
        print(json.dumps(activate()), flush=True)
    except Exception as error:
        # Do not print database or environment messages from third-party tools.
        print(json.dumps({"error": str(error) if type(error) is GuardError else "Activation failed; inspect before retry."}), flush=True)
        sys.exit(1)
