param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$TargetDatabase, [switch]$Apply, [switch]$DropAfterVerify, [string]$MySqlPath = '')
$ErrorActionPreference = 'Stop'
if ($TargetDatabase -notmatch '^[A-Za-z0-9_]+$' -or $TargetDatabase -notmatch 'restore_test') { throw 'La base destino debe ser temporal e incluir restore_test en el nombre.' }
function Read-EnvFile([string]$FilePath) { $result=@{}; if (!(Test-Path -LiteralPath $FilePath)){return $result}; foreach($line in Get-Content -LiteralPath $FilePath){if($line -match '^\s*#' -or $line -notmatch '='){continue};$parts=$line -split '=',2;$result[$parts[0].Trim()]=$parts[1].Trim().Trim('"').Trim("'")};return $result }
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $PSScriptRoot 'verify-inventory-backup.ps1') -Archive $Archive | Out-Null
$settings=Read-EnvFile (Join-Path $root '.env'); foreach($entry in (Read-EnvFile (Join-Path $root '.env.local')).GetEnumerator()){$settings[$entry.Key]=$entry.Value}
if ($TargetDatabase -eq $settings.DB_NAME) { throw 'La restauración sobre la base configurada está bloqueada.' }
if (!$Apply) { [pscustomobject]@{ valid=$true; apply=$false; target=$TargetDatabase; archive=(Resolve-Path $Archive).Path } | ConvertTo-Json; exit 0 }
if (!$MySqlPath) { $found=Get-Command mysql -ErrorAction SilentlyContinue; if($found){$MySqlPath=$found.Source}else{$MySqlPath='C:\Program Files\MySQL\MySQL Workbench 8.0 CE\mysql.exe'} }
if (!(Test-Path -LiteralPath $MySqlPath)) { throw 'No se encontró mysql.exe. Indica -MySqlPath.' }
$temporary=Join-Path ([IO.Path]::GetTempPath()) "seep-restore-$([guid]::NewGuid())"; $optionFile=Join-Path ([IO.Path]::GetTempPath()) "seep-mysql-$([guid]::NewGuid()).cnf"
try {
  Expand-Archive -LiteralPath $Archive -DestinationPath $temporary
  $optionLines=@('[client]',"host=$($settings.DB_HOST)","port=$(if($settings.DB_PORT){$settings.DB_PORT}else{'3306'})","user=$($settings.DB_USER)","password=$($settings.DB_PASSWORD)",'default-character-set=utf8mb4')
  [IO.File]::WriteAllLines($optionFile,$optionLines,(New-Object Text.UTF8Encoding($false)))
  & $MySqlPath "--defaults-extra-file=$optionFile" -e "DROP DATABASE IF EXISTS ``$TargetDatabase``; CREATE DATABASE ``$TargetDatabase`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  if($LASTEXITCODE -ne 0){throw 'No se pudo crear la base temporal.'}
  Get-Content -LiteralPath (Join-Path $temporary 'database.sql') -Raw | & $MySqlPath "--defaults-extra-file=$optionFile" $TargetDatabase
  if($LASTEXITCODE -ne 0){throw 'No se pudo restaurar el SQL.'}
  $counts=& $MySqlPath "--defaults-extra-file=$optionFile" --batch --skip-column-names $TargetDatabase -e 'SELECT (SELECT COUNT(*) FROM inv_producto),(SELECT COUNT(*) FROM inv_existencia),(SELECT COUNT(*) FROM inv_migracion);'
  [pscustomobject]@{ valid=$true; restored=$true; target=$TargetDatabase; counts=$counts; dropped_after_verify=$DropAfterVerify.IsPresent } | ConvertTo-Json
  if($DropAfterVerify){& $MySqlPath "--defaults-extra-file=$optionFile" -e "DROP DATABASE ``$TargetDatabase``;";if($LASTEXITCODE -ne 0){throw 'La restauración fue válida, pero no se pudo retirar la base temporal.'}}
} finally { Remove-Item -LiteralPath $optionFile,$temporary -Recurse -Force -ErrorAction SilentlyContinue }
