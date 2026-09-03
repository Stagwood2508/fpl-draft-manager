param(
  [string]$SourceDirectory = "C:\Users\Chandy\Documents",
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\assets\store\screenshots")
)

Add-Type -AssemblyName System.Drawing

$screens = @(
  @{ File = "138246.jpg"; Output = "01-league-home.png"; Title = "YOUR LEAGUE. ONE HOME."; Subtitle = "Fixtures, standings and key actions at a glance" },
  @{ File = "138248.jpg"; Output = "02-manage-your-squad.png"; Title = "BUILD YOUR BEST XI"; Subtitle = "Manage lineups, fixtures and automatic substitutes" },
  @{ File = "138250.jpg"; Output = "03-player-scout.png"; Title = "SCOUT EVERY PLAYER"; Subtitle = "Compare points, availability and ownership" },
  @{ File = "138252.jpg"; Output = "04-matchups.png"; Title = "FOLLOW EVERY MATCHUP"; Subtitle = "Results with custom DEFCON scoring" },
  @{ File = "138254.jpg"; Output = "05-league-table.png"; Title = "COMPETE FOR THE TITLE"; Subtitle = "Standings, cups, statistics and league history" },
  @{ File = "138256.jpg"; Output = "06-league-lounge.png"; Title = "YOUR LEAGUE LOUNGE"; Subtitle = "Keep every manager connected in one place" }
)

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$iconPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\public\icon-512.png"))
$icon = [System.Drawing.Image]::FromFile($iconPath)

$background = [System.Drawing.ColorTranslator]::FromHtml("#020B14")
$panel = [System.Drawing.ColorTranslator]::FromHtml("#071725")
$border = [System.Drawing.ColorTranslator]::FromHtml("#21384B")
$mint = [System.Drawing.ColorTranslator]::FromHtml("#00F58A")
$white = [System.Drawing.ColorTranslator]::FromHtml("#F7FAFC")
$muted = [System.Drawing.ColorTranslator]::FromHtml("#9FB0C2")

$titleFont = New-Object System.Drawing.Font("Arial", 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
$subtitleFont = New-Object System.Drawing.Font("Arial", 21, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))

foreach ($screen in $screens) {
  $sourcePath = Join-Path $SourceDirectory $screen.File
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Screenshot not found: $sourcePath"
  }

  $source = [System.Drawing.Image]::FromFile($sourcePath)
  $canvas = New-Object System.Drawing.Bitmap 1080, 1920
  $canvas.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear($background)

  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($mint)), 0, 0, 1080, 8)
  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($panel)), 0, 8, 1080, 164)

  $graphics.DrawImage($icon, (New-Object System.Drawing.Rectangle 38, 35, 104, 104))
  $graphics.DrawString($screen.Title, $titleFont, (New-Object System.Drawing.SolidBrush($white)), 166, 42)
  $graphics.DrawString($screen.Subtitle, $subtitleFont, (New-Object System.Drawing.SolidBrush($muted)), 167, 94)
  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($mint)), 167, 132, 92, 4)

  $maxWidth = 900
  $maxHeight = 1675
  $scale = [Math]::Min($maxWidth / $source.Width, $maxHeight / $source.Height)
  $drawWidth = [int][Math]::Round($source.Width * $scale)
  $drawHeight = [int][Math]::Round($source.Height * $scale)
  $drawX = [int][Math]::Round((1080 - $drawWidth) / 2)
  $drawY = 188

  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(115, 0, 0, 0))
  $graphics.FillRectangle($shadowBrush, $drawX - 16, $drawY + 16, $drawWidth + 32, $drawHeight + 22)
  $graphics.FillRectangle((New-Object System.Drawing.SolidBrush($border)), $drawX - 3, $drawY - 3, $drawWidth + 6, $drawHeight + 6)
  $graphics.DrawImage($source, (New-Object System.Drawing.Rectangle $drawX, $drawY, $drawWidth, $drawHeight))

  $destination = Join-Path $outputPath $screen.Output
  $canvas.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)

  $shadowBrush.Dispose()
  $graphics.Dispose()
  $canvas.Dispose()
  $source.Dispose()
}

$titleFont.Dispose()
$subtitleFont.Dispose()
$icon.Dispose()

Get-ChildItem -LiteralPath $outputPath -Filter "*.png" |
  Sort-Object Name |
  ForEach-Object {
    $image = [System.Drawing.Image]::FromFile($_.FullName)
    [PSCustomObject]@{
      File = $_.Name
      Width = $image.Width
      Height = $image.Height
      Megabytes = [Math]::Round($_.Length / 1MB, 2)
    }
    $image.Dispose()
  }
