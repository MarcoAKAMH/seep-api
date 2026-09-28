param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Archive)) { throw 'El respaldo no existe.' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) "seep-backup-$([guid]::NewGuid())"
try {
  Expand-Archive -LiteralPath $Archive -DestinationPath $temporary
  $manifestPath = Join-Path $temporary 'manifest.json'; if (!(Test-Path -LiteralPath $manifestPath)) { throw 'El respaldo no contiene manifest.json.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    $candidate = Join-Path $temporary ($file.path.Replace('/', '\'))
    if (!(Test-Path -LiteralPath $candidate)) { throw "Falta $($file.path)." }
    $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $file.sha256 -or (Get-Item -LiteralPath $candidate).Length -ne $file.bytes) { throw "Falló la integridad de $($file.path)." }
  }
  if (!(Select-String -LiteralPath (Join-Path $temporary 'database.sql') -Pattern 'CREATE TABLE' -Quiet)) { throw 'El SQL no contiene estructura restaurable.' }
  [pscustomobject]@{ valid=$true; database=$manifest.database; created_at=$manifest.created_at; files=$manifest.files.Count; archive=(Resolve-Path $Archive).Path } | ConvertTo-Json
} finally { Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue }
