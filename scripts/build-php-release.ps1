$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path (Split-Path -Parent $root) 'artifacts'
$release = Join-Path $artifactRoot 'nimble-php-release'
$archive = Join-Path $artifactRoot 'nimble-php-release.zip'

if (-not (Test-Path -LiteralPath $artifactRoot)) { New-Item -ItemType Directory -Path $artifactRoot | Out-Null }
if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
New-Item -ItemType Directory -Path $release, (Join-Path $release 'assets'), (Join-Path $release 'lib'), (Join-Path $release 'storage') | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'php-backend\index.php') -Destination $release
Copy-Item -LiteralPath (Join-Path $root 'php-backend\.htaccess') -Destination (Join-Path $release '.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'php-backend\.user.ini') -Destination (Join-Path $release '.user.ini')
Copy-Item -LiteralPath (Join-Path $root 'php-backend\config.example.php') -Destination (Join-Path $release 'config.example.php')
Copy-Item -LiteralPath (Join-Path $root 'php-backend\storage\.htaccess') -Destination (Join-Path $release 'storage\.htaccess')
Copy-Item -LiteralPath (Join-Path $root 'php-backend\lib\site-model.php'), (Join-Path $root 'php-backend\lib\render.php') -Destination (Join-Path $release 'lib')
Copy-Item -LiteralPath (Join-Path $root 'PHP_SHARED_HOSTING.md') -Destination (Join-Path $release 'README.md')
Copy-Item -LiteralPath (Join-Path $root 'builder.html'), (Join-Path $root 'login.html'), (Join-Path $root 'control-panel.html') -Destination $release
Copy-Item -LiteralPath (Join-Path $root 'assets\builder.js'), (Join-Path $root 'assets\control-panel.js'), (Join-Path $root 'assets\login.js'), (Join-Path $root 'assets\public.js'), (Join-Path $root 'assets\public.css'), (Join-Path $root 'assets\editor.css'), (Join-Path $root 'lib\site-model.mjs'), (Join-Path $root 'lib\render.mjs') -Destination (Join-Path $release 'assets')

Compress-Archive -Path (Join-Path $release '*') -DestinationPath $archive -CompressionLevel Optimal
Write-Output "Created $archive"
