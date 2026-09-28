$ErrorActionPreference = 'Stop'
$api = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$app = (Resolve-Path (Join-Path $api '..\seep-app')).Path
Push-Location $api
try {
  npm run inventory:check
  npm run inventory:controls:check
  npm run inventory:alerts:check
  npm run inventory:purchasing:check
  npm run inventory:counts:check
  npm run inventory:quality
  npm run inventory:media:preview
  npm run inventory:counts:weekly:preview
  npm run inventory:uat
} finally { Pop-Location }
Push-Location $app
try { npm run build; npm run test:inventory-ui } finally { Pop-Location }
