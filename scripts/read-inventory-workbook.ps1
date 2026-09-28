param(
  [Parameter(Mandatory=$true)][string]$InputFile,
  [Parameter(Mandatory=$true)][string]$OutputFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $InputFile).Path)
try {
  function Read-Entry([string]$name) {
    $entry = $zip.GetEntry($name)
    if (!$entry) { return $null }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }
  [xml]$workbook = Read-Entry 'xl/workbook.xml'
  [xml]$relationships = Read-Entry 'xl/_rels/workbook.xml.rels'
  [xml]$sharedXml = Read-Entry 'xl/sharedStrings.xml'
  $strings = @($sharedXml.sst.si | ForEach-Object {
    ($_.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join ''
  })
  $sheets = @()
  foreach ($sheet in $workbook.workbook.sheets.sheet) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = ($relationships.Relationships.Relationship | Where-Object Id -eq $rid).Target
    $entryName = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }
    [xml]$document = Read-Entry $entryName
    $rows = @()
    foreach ($row in $document.worksheet.sheetData.row) {
      $cells = @{}
      $formulas = @{}
      foreach ($cell in $row.c) {
        $node = $cell.SelectSingleNode('./*[local-name()="v"]')
        $value = if ($null -ne $node) { $node.InnerText } else { '' }
        if ($cell.t -eq 's') { $value = $strings[[int]$value] }
        elseif ($cell.t -eq 'inlineStr') { $value = ($cell.SelectNodes('./*[local-name()="is"]//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' }
        if ($value -ne '') { $cells[[string]$cell.r] = $value }
        $formula = $cell.SelectSingleNode('./*[local-name()="f"]')
        if ($null -ne $formula) { $formulas[[string]$cell.r] = $formula.InnerText }
      }
      if ($cells.Count -or $formulas.Count) { $rows += @{ row = [int]$row.r; cells = $cells; formulas = $formulas } }
    }
    $sheets += @{ name = [string]$sheet.name; path = $entryName; rows = $rows }
  }
  $result = @{ file = [IO.Path]::GetFileName($InputFile); sha256 = (Get-FileHash -LiteralPath $InputFile -Algorithm SHA256).Hash.ToLower(); sheets = $sheets }
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile), (ConvertTo-Json -InputObject $result -Depth 10), [Text.UTF8Encoding]::new($false))
  Write-Output ("Read " + $sheets.Count + " sheets into " + $OutputFile)
} finally { $zip.Dispose() }
