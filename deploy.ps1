$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath '.env')) {
  throw 'Missing .env. Copy .env.example to .env and set the production values.'
}

docker compose -f docker-compose.production.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration validation failed.' }
docker compose -f docker-compose.production.yml build studio
if ($LASTEXITCODE -ne 0) { throw 'Production image build failed.' }
$deploymentEnv = (Join-Path -Path $PSScriptRoot -ChildPath '.env') + ':/run/nimble.env:ro'
$publicOrigin = docker compose -f docker-compose.production.yml run --rm --no-deps -T --volume $deploymentEnv --entrypoint node studio scripts/validate-env.mjs /run/nimble.env --print-origin
if ($LASTEXITCODE -ne 0) { throw 'Production configuration validation failed.' }
docker compose -f docker-compose.production.yml up -d --no-build --wait
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed to become healthy. Check docker compose logs.' }
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml exec -T studio node scripts/check-public.mjs
if ($LASTEXITCODE -ne 0) { throw 'Containers started, but public HTTPS verification failed. Check DNS, firewall and Caddy certificate logs.' }
Write-Output ('Public HTTPS verified: ' + $publicOrigin.Trim())
