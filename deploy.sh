#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and set the production values."
  exit 1
fi

docker compose -f docker-compose.production.yml config --quiet
docker compose -f docker-compose.production.yml build studio
public_origin="$(docker compose -f docker-compose.production.yml run --rm --no-deps -T --volume "$PWD/.env:/run/nimble.env:ro" --entrypoint node studio scripts/validate-env.mjs /run/nimble.env --print-origin)"
docker compose -f docker-compose.production.yml up -d --no-build --wait
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml exec -T studio node scripts/check-public.mjs
