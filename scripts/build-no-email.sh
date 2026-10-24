#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
AUTOREPORT_ANONYMOUS_CLOUD=1 npm run build
cp dist/cloud/cloud-config.js dist/cloud/cloud-config-email.js
cat > dist/cloud/cloud-config.js <<'EOF'
import config from './cloud-config-email.js';
export default {...config, requireLoginForAnalysis: false, anonymousAuth: true};
EOF
output='.vercel-no-email/.vercel/output'
rm -rf .vercel-no-email
mkdir -p "$output/static"
cp -a dist/. "$output/static/"
cat > "$output/config.json" <<'EOF'
{
  "version": 3,
  "routes": [
    {"src":"/(.*)","headers":{"X-Content-Type-Options":"nosniff"},"continue":true},
    {"src":"/cloud/(.*)","headers":{"Cache-Control":"no-cache"},"continue":true},
    {"src":"/release\\.json","headers":{"Cache-Control":"no-cache"},"continue":true},
    {"handle":"filesystem"}
  ]
}
EOF
printf 'Prepared anonymous-cloud Vercel build in .vercel-no-email/.vercel/output\n'
