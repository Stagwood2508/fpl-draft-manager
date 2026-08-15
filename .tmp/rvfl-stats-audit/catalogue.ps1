Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourcePath = 'C:\Users\Chandy\Documents\RVFL Stats 25-26.xlsx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($sourcePath)

function Read-ZipEntryText([string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

try {
  [xml]$workbookXml = Read-ZipEntryText 'xl/workbook.xml'
  [xml]$relationshipsXml = Read-ZipEntryText 'xl/_rels/workbook.xml.rels'
  [xml]$sharedXml = Read-ZipEntryText 'xl/sharedStrings.xml'

  $relationshipTargets = @{}
  foreach ($relationship in $relationshipsXml.SelectNodes("//*[local-name()='Relationship']")) {
    $relationshipTargets[$relationship.GetAttribute('Id')] = $relationship.GetAttribute('Target')
  }

  $sharedStrings = @()
  if ($sharedXml) {
    foreach ($item in $sharedXml.SelectNodes("//*[local-name()='si']")) { $sharedStrings += [string]$item.InnerText }
  }

  $catalogue = @()
  foreach ($sheet in $workbookXml.SelectNodes("//*[local-name()='sheets']/*[local-name()='sheet']")) {
    $relationshipId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = [string]$relationshipTargets[$relationshipId]
    if ($target.StartsWith('/')) {
      $sheetPath = $target.TrimStart('/')
    } else {
      $sheetPath = 'xl/' + $target.TrimStart('./')
    }

    [xml]$sheetXml = Read-ZipEntryText $sheetPath
    $cells = @($sheetXml.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']/*[local-name()='c']"))
    $formulas = @($cells | Where-Object { $_.SelectSingleNode("./*[local-name()='f']") })
    $rows = @($sheetXml.SelectNodes("//*[local-name()='sheetData']/*[local-name()='row']"))
    $sampleRows = @()

    foreach ($row in ($rows | Select-Object -First 18)) {
      $sampleCells = @()
      foreach ($cell in @($row.SelectNodes("./*[local-name()='c']"))) {
        $valueNode = $cell.SelectSingleNode("./*[local-name()='v']")
        $formulaNode = $cell.SelectSingleNode("./*[local-name()='f']")
        $inlineNode = $cell.SelectSingleNode("./*[local-name()='is']")
        $value = if ($valueNode) { [string]$valueNode.InnerText } else { '' }
        if ($cell.GetAttribute('t') -eq 's' -and $value -match '^\d+$') {
          $value = $sharedStrings[[int]$value]
        } elseif ($cell.GetAttribute('t') -eq 'inlineStr') {
          $value = [string]$inlineNode.InnerText
        }
        if ($value -or $formulaNode) {
          $sampleCells += [ordered]@{
            address = $cell.GetAttribute('r')
            value = $value
            formula = if ($formulaNode) { [string]$formulaNode.InnerText } else { $null }
          }
        }
      }
      if ($sampleCells.Count -gt 0) {
        $sampleRows += [ordered]@{ row = [int]$row.GetAttribute('r'); cells = $sampleCells }
      }
    }

    $catalogue += [ordered]@{
      name = $sheet.GetAttribute('name')
      state = $sheet.GetAttribute('state')
      path = $sheetPath
      dimension = $sheetXml.SelectSingleNode("//*[local-name()='dimension']").GetAttribute('ref')
      rowCount = $rows.Count
      cellCount = $cells.Count
      formulaCount = $formulas.Count
      mergedRangeCount = @($sheetXml.SelectNodes("//*[local-name()='mergeCells']/*[local-name()='mergeCell']")).Count
      hasDrawing = [bool]$sheetXml.SelectSingleNode("//*[local-name()='drawing']")
      sample = $sampleRows
    }
  }

  $catalogue | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '.\catalogue.json' -Encoding utf8
  $catalogue | Select-Object name,state,dimension,rowCount,cellCount,formulaCount,mergedRangeCount,hasDrawing | Format-Table -AutoSize
} finally {
  $zip.Dispose()
}
