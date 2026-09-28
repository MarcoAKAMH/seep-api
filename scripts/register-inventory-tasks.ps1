param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tasks = @(
  [pscustomobject]@{ Name='SEEP Inventario - Alertas'; Schedule='DAILY'; Time='06:30'; Days=$null; Command=(Join-Path $root 'ops\tasks\inventory-alerts.cmd') },
  [pscustomobject]@{ Name='SEEP Inventario - Conteos'; Schedule='WEEKLY'; Time='07:00'; Days='MON'; Command=(Join-Path $root 'ops\tasks\inventory-counts.cmd') },
  [pscustomobject]@{ Name='SEEP Inventario - Respaldo'; Schedule='DAILY'; Time='02:00'; Days=$null; Command=(Join-Path $root 'ops\tasks\inventory-backup.cmd') },
  [pscustomobject]@{ Name='SEEP Inventario - Limpieza'; Schedule='WEEKLY'; Time='03:00'; Days='SUN'; Command=(Join-Path $root 'ops\tasks\inventory-media-cleanup.cmd') }
)
foreach ($task in $tasks) {
  if (!(Test-Path -LiteralPath $task.Command)) { throw "No existe $($task.Command)" }
  if ($Apply) {
    $arguments = @('/Create','/F','/TN',$task.Name,'/TR',('"{0}"' -f $task.Command),'/SC',$task.Schedule,'/ST',$task.Time)
    if ($task.Days) { $arguments += @('/D',$task.Days) }
    & schtasks.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "No se pudo registrar $($task.Name). Ejecuta PowerShell como administrador." }
  }
}
$tasks | Select-Object Name,Schedule,Time,Days,Command,@{Name='Registered';Expression={$Apply.IsPresent}} | Format-Table -AutoSize
if (!$Apply) { Write-Output 'Vista previa: no se registraron tareas. Usa -Apply desde PowerShell como administrador cuando se apruebe la puesta en producción.' }
