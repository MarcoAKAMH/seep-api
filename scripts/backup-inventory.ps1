param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\backups\inventory'), [int]$RetentionDays = 30, [string]$MySqlDumpPath = '')
$ErrorActionPreference = 'Stop'
function Read-EnvFile([string]$FilePath) {
  $result = @{}
  if (!(Test-Path -LiteralPath $FilePath)) { return $result }
  foreach ($line in Get-Content -LiteralPath $FilePath) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2; $result[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $result
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$settings = Read-EnvFile (Join-Path $root '.env')
foreach ($entry in (Read-EnvFile (Join-Path $root '.env.local')).GetEnumerator()) { $settings[$entry.Key] = $entry.Value }
if (!$MySqlDumpPath) {
  $found = Get-Command mysqldump -ErrorAction SilentlyContinue
  if ($found) { $MySqlDumpPath = $found.Source } else { $MySqlDumpPath = 'C:\Program Files\MySQL\MySQL Workbench 8.0 CE\mysqldump.exe' }
}
if (!(Test-Path -LiteralPath $MySqlDumpPath)) { throw 'No se encontró mysqldump. Indica -MySqlDumpPath.' }
$database = if ($settings.DB_NAME) { $settings.DB_NAME } else { 'seep_taller' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputRoot = (New-Item -ItemType Directory -Force -Path $OutputDirectory).FullName
$stage = (New-Item -ItemType Directory -Force -Path (Join-Path $outputRoot "stage-$stamp")).FullName
$optionFile = Join-Path ([IO.Path]::GetTempPath()) "seep-mysql-$([guid]::NewGuid()).cnf"
try {
  $optionLines = @("[client]", "host=$($settings.DB_HOST)", "port=$(if($settings.DB_PORT){$settings.DB_PORT}else{'3306'})", "user=$($settings.DB_USER)", "password=$($settings.DB_PASSWORD)", 'default-character-set=utf8mb4')
  [IO.File]::WriteAllLines($optionFile, $optionLines, (New-Object Text.UTF8Encoding($false)))
  $sqlFile = Join-Path $stage 'database.sql'
  & $MySqlDumpPath "--defaults-extra-file=$optionFile" '--single-transaction' '--routines' '--triggers' '--hex-blob' '--set-gtid-purged=OFF' '--column-statistics=0' "--result-file=$sqlFile" $database
  if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $sqlFile)) { throw "mysqldump terminó con código $LASTEXITCODE" }
  $media = Join-Path $stage 'uploads'; New-Item -ItemType Directory -Force -Path $media | Out-Null
  foreach ($folder in @('uploads\inventory','uploads\inventory-counts')) { $source = Join-Path $root $folder; if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $media -Recurse } }
  $manifest = @(Get-ChildItem -LiteralPath $stage -File -Recurse | ForEach-Object { $relative = $_.FullName.Substring(($stage.Length + 1)); [pscustomobject]@{ path = $relative.Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() } })
  [pscustomobject]@{ created_at=(Get-Date).ToString('o'); database=$database; files=$manifest } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding UTF8
  $archive = Join-Path $outputRoot "seep-inventory-$stamp.zip"; Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal
  Get-ChildItem -LiteralPath $outputRoot -Filter 'seep-inventory-*.zip' -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) | Remove-Item -Force
  Write-Output $archive
} finally { Remove-Item -LiteralPath $optionFile,$stage -Recurse -Force -ErrorAction SilentlyContinue }
