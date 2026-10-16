#!/usr/bin/env bash
# Run the reviewed seeder from a pinned commit, without changing live app code.
set -euo pipefail
revision="${1:?Pass the reviewed Git commit}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full Git commit'; exit 1; }
root=/root/primesecure-library-stage
mkdir -p "$root"
if [[ ! -d "$root/workspace/.git" ]]; then
 git clone --depth 1 --branch feat/student-hub https://github.com/wilson3centaurus/primesecure.git "$root/workspace"
fi
[[ -z "$(git -C "$root/workspace" status --porcelain)" ]] || { echo 'Mirror checkout contains changes; preserving it'; exit 1; }
git -C "$root/workspace" fetch --depth 1 origin "$revision"
git -C "$root/workspace" checkout --detach FETCH_HEAD
export PATH="/opt/node-v20.19.6-linux-x64/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$root/browsers"
npm install --prefix "$root/browser" playwright@1.63.0
node "$root/browser/node_modules/playwright/cli.js" install chromium
# Extract only the missing browser libraries into the task directory. No system
# packages, SSH settings, firewall rules, or production app deployments change.
mkdir -p "$root/browser-libs/debs"
cd "$root/browser-libs/debs"
apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libasound2t64
for package in *.deb; do dpkg-deb -x "$package" "$root/browser-libs"; done
python3 -m pip install --disable-pip-version-check --target "$root/library-python" reportlab
export PYTHONPATH="$root/library-python:/root/primesecure-library-python"
nohup python3 "$root/workspace/tools/library/mirror-reviewed-server.py" > "$root/mirror-progress.log" 2>&1 < /dev/null &
echo "Reviewed publisher download and import started: PID $!"
echo "Progress: $root/mirror-progress.log"
