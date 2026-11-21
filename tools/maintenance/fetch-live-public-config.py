"""Read the public PrimeSecure client configuration from the trusted live host.

The value returned here is the Supabase anonymous/public client key, never the
service-role key.  Callers should capture stdout rather than logging it.
"""

import json
from pathlib import Path

import paramiko


HOST = "178.238.227.229"


def main() -> None:
    client = paramiko.SSHClient()
    client.load_system_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(
        HOST,
        username="root",
        key_filename=str(Path.home() / ".ssh" / "primesecure_support_ed25519"),
        timeout=15,
        allow_agent=False,
        look_for_keys=False,
    )
    try:
        _, stdout, stderr = client.exec_command("docker inspect supabase-kong")
        payload = stdout.read().decode()
        error = stderr.read().decode()
        if stdout.channel.recv_exit_status() != 0:
            raise RuntimeError(error[-1200:])
        info = json.loads(payload)[0]
        env = dict(item.split("=", 1) for item in info["Config"]["Env"] if "=" in item)
        public_key = env.get("SUPABASE_ANON_KEY") or env.get("ANON_KEY")
        if not public_key:
            raise RuntimeError("Live public client key is unavailable")
        print(public_key)
    finally:
        client.close()


if __name__ == "__main__":
    main()
