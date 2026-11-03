#!/usr/bin/env pwsh
<#
  Resize the Lockin app icon into the four sizes the extension manifest wants.
  Run after changing the brand glyph:

      pwsh tools/gen-extension-icons.ps1
#>
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src  = Join-Path $root 'app\assets\icons\icon-512.png'
$out  = Join-Path $root 'extension\icons'
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Force -Path $out | Out-Null }

$source = [System.Drawing.Image]::FromFile($src)

foreach ($size in 16, 32, 48, 128) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($source, 0, 0, $size, $size)
  $g.Dispose()
  $path = Join-Path $out "icon-$size.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  icon-$size.png"
}

$source.Dispose()
Write-Host "Extension icons written to extension/icons/"
