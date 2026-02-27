#!/bin/zsh
set -euo pipefail

# Load .env if present (set FACTORY_API_KEY there)
ENV_FILE="$(dirname "$0")/../naon.py/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if [ -z "${FACTORY_API_KEY:-}" ]; then
  echo "ERROR: FACTORY_API_KEY is not set. Export it before running:" >&2
  echo "  export FACTORY_API_KEY=<your-secret>" >&2
  exit 1
fi

exec ./gradlew bootRun --args='--server.address=127.0.0.1 --server.port=9090'
