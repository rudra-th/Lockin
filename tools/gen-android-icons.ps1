#!/usr/bin/env pwsh
<#
  Lockin Android art — no dependencies beyond .NET's System.Drawing.
  Regenerates the adaptive launcher icon, the legacy square/round icons and
  every splash bitmap from the same stopwatch-padlock glyph as the PWA.

      pwsh tools/gen-android-icons.ps1

  Android Studio is not required; the output lands in android/app/src/main/res.
#>
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$bg      = '#0B0D12'
$lime    = '#C6F24E'
$limeTop = '#D9FF6E'
$limeBot = '#93BE1F'

$res = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'android\app\src\main\res'

function New-Glyph {
  param(
    [System.Drawing.Graphics]$G,
    [int]$Size,
    [double]$ContentScale = 1.0,
    [bool]$Transparent = $false
  )

  $cx = $Size * 0.5
  $cy = $Size * 0.5
  $s  = $Size * $ContentScale

  $R    = $s * 0.300
  $penW = $s * 0.062

  # crown sitting in the ring gap
  $crownR = $s * 0.045
  $crownBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($lime))
  $G.FillEllipse($crownBrush, $cx - $crownR, $cy - $R - $crownR * 1.9, $crownR * 2, $crownR * 2)
  $G.FillRectangle($crownBrush, $cx - $penW / 2, $cy - $R - $crownR * 0.4, $penW, $crownR * 0.9)

  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($lime), $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $G.DrawArc($pen, $cx - $R, $cy - $R, $R * 2, $R * 2, -65, 310)
  $pen.Dispose()

  # shackle
  $ry = $s * 0.112
  $shPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($lime), $s * 0.048)
  $G.DrawArc($shPen, $cx - $ry, ($cy - 0.075 * $s) - $ry, $ry * 2, $ry * 2, 180, 180)
  $shPen.Dispose()

  # body
  $bw = $s * 0.360
  $bh = $s * 0.300
  $bx = $cx - $bw / 2
  $by = $cy - $bh / 2 + $s * 0.022
  $rad = $s * 0.072
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $d = $rad * 2
  $path.AddArc($bx, $by, $d, $d, 180, 90)
  $path.AddArc($bx + $bw - $d, $by, $d, $d, 270, 90)
  $path.AddArc($bx + $bw - $d, $by + $bh - $d, $d, $d, 0, 90)
  $path.AddArc($bx, $by + $bh - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $grad = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.Point]::new([int]$bx, [int]$by),
            [System.Drawing.Point]::new([int]$bx, [int]($by + $bh)),
            [System.Drawing.ColorTranslator]::FromHtml($limeTop),
            [System.Drawing.ColorTranslator]::FromHtml($limeBot))
  $G.FillPath($grad, $path)
  $grad.Dispose()
  $path.Dispose()

  # keyhole (transparent cut would need a mask; the shell bg matches)
  $hr = $s * 0.043
  $hy = $cy - $s * 0.008
  $holeBrush = [System.Drawing.SolidBrush]::new(
    $(if ($Transparent) { [System.Drawing.Color]::FromArgb(255, 11, 13, 18) }
      else { [System.Drawing.ColorTranslator]::FromHtml($bg) }))
  $G.FillEllipse($holeBrush, $cx - $hr, $hy - $hr, $hr * 2, $hr * 2)
  $G.FillRectangle($holeBrush, $cx - $s * 0.020, $hy, $s * 0.040, $s * 0.088)
  $holeBrush.Dispose()
  $crownBrush.Dispose()
}

function New-Image {
  param(
    [int]$Width,
    [int]$Height,
    [string]$Path,
    [string]$Shape = 'square',   # square | round | none
    [double]$ContentScale = 0.86
  )

  $bmp = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  if ($Shape -eq 'fill') {
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg))
  } elseif ($Shape -eq 'square' -or $Shape -eq 'round') {
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($bg))
    if ($Shape -eq 'round') {
      $g.FillEllipse($brush, 0, 0, $Width, $Height)
    } else {
      $pad = [Math]::Max(1, [int]($Width * 0.045))
      $rad = [int]($Width * 0.20)
      $p = [System.Drawing.Drawing2D.GraphicsPath]::new()
      $d = $rad * 2
      $x = $pad; $y = $pad; $w = $Width - $pad * 2; $h = $Height - $pad * 2
      $p.AddArc($x, $y, $d, $d, 180, 90)
      $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
      $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
      $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
      $p.CloseFigure()
      $g.FillPath($brush, $p)
      $p.Dispose()
    }
    $brush.Dispose()
  }

  $scale = $ContentScale
  if ($Shape -eq 'none') { $scale = $ContentScale }
  New-Glyph -G $g -Size ([Math]::Min($Width, $Height)) -ContentScale $scale -Transparent ($Shape -eq 'none')

  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  "{0}  {1}x{2}" -f (Split-Path -Leaf $Path), $Width, $Height
}

# ---------- launcher icons ----------

$densities = @(
  @{ name = 'mdpi';    legacy = 48;  foreground = 108; splashW = 320;  splashH = 480;  landW = 480;  landH = 320 },
  @{ name = 'hdpi';    legacy = 72;  foreground = 162; splashW = 480;  splashH = 800;  landW = 800;  landH = 480 },
  @{ name = 'xhdpi';   legacy = 96;  foreground = 216; splashW = 720;  splashH = 1280; landW = 1280; landH = 720 },
  @{ name = 'xxhdpi';  legacy = 144; foreground = 324; splashW = 960;  splashH = 1600; landW = 1600; landH = 960 },
  @{ name = 'xxxhdpi'; legacy = 192; foreground = 432; splashW = 1280; splashH = 1920; landW = 1920; landH = 1280 }
)

foreach ($d in $densities) {
  $dir = Join-Path $res "mipmap-$($d.name)"
  New-Image -Width $d.legacy -Height $d.legacy -Path (Join-Path $dir 'ic_launcher.png') -Shape 'square' -ContentScale 0.78 | Out-Null
  New-Image -Width $d.legacy -Height $d.legacy -Path (Join-Path $dir 'ic_launcher_round.png') -Shape 'round' -ContentScale 0.72 | Out-Null
  New-Image -Width $d.foreground -Height $d.foreground -Path (Join-Path $dir 'ic_launcher_foreground.png') -Shape 'none' -ContentScale 0.74 | Out-Null
  "mipmap-$($d.name): $($d.legacy)px legacy, $($d.foreground)px foreground"
}

# ---------- splash ----------

New-Image -Width 480 -Height 320 -Path (Join-Path $res 'drawable\splash.png') -Shape 'fill' -ContentScale 0.46 | Out-Null
foreach ($d in $densities) {
  New-Image -Width $d.landW -Height $d.landH -Path (Join-Path $res "drawable-land-$($d.name)\splash.png") -Shape 'fill' -ContentScale 0.42 | Out-Null
  New-Image -Width $d.splashW -Height $d.splashH -Path (Join-Path $res "drawable-port-$($d.name)\splash.png") -Shape 'fill' -ContentScale 0.30 | Out-Null
  "splash $($d.name): $($d.splashW)x$($d.splashH) portrait, $($d.landW)x$($d.landH) landscape"
}

# The adaptive icon background must match the splash canvas.
$colors = Join-Path $res 'values\ic_launcher_background.xml'
@'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0B0D12</color>
</resources>
'@ | Set-Content $colors -Encoding UTF8

Write-Output 'Android art regenerated.'
