#!/usr/bin/env pwsh
<#
  Lockin icon generator — no dependencies beyond .NET's System.Drawing.
  Draws the brand glyph (stopwatch ring housing a padlock body) straight to
  PNG at every size the PWA needs. Regenerate after any palette change:

      pwsh tools/gen-icons.ps1
#>
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$bg      = '#0B0D12'
$lime    = '#C6F24E'
$limeTop = '#D9FF6E'
$limeBot = '#93BE1F'

$dir = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')) 'assets\icons'
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

function New-Icon {
  param([int]$Size, [string]$Name, [double]$ContentScale = 1.0)

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg))

  $cx = $Size * 0.5
  $cy = $Size * 0.5
  $s  = $Size * $ContentScale

  # stopwatch ring: 310 degrees with a 50-degree gap centred at 12 o'clock
  $R    = $s * 0.300
  $penW = $s * 0.062

  # crown sitting in the ring gap (reads "stopwatch", not just "padlock")
  $crownR = $s * 0.045
  $g.FillEllipse([System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($lime)),
                 $cx - $crownR, $cy - $R - $crownR * 1.9, $crownR * 2, $crownR * 2)
  $g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($lime)),
                   $cx - $penW / 2, $cy - $R - $crownR * 0.4, $penW, $crownR * 0.9)

  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($lime), $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($pen, $cx - $R, $cy - $R, $R * 2, $R * 2, -65, 310)
  $pen.Dispose()

  # padlock shackle (behind the body)
  $ry = $s * 0.112
  $shPen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($lime), $s * 0.048)
  $g.DrawArc($shPen, $cx - $ry, ($cy - 0.075 * $s) - $ry, $ry * 2, $ry * 2, 180, 180)
  $shPen.Dispose()

  # padlock body: lime gradient, rounded square
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
  $g.FillPath($grad, $path)
  $grad.Dispose()
  $path.Dispose()

  # keyhole
  $hr = $s * 0.043
  $hy = $cy - $s * 0.008
  $holeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($bg))
  $g.FillEllipse($holeBrush, $cx - $hr, $hy - $hr, $hr * 2, $hr * 2)
  $g.FillRectangle($holeBrush, $cx - $s * 0.020, $hy, $s * 0.040, $s * 0.088)
  $holeBrush.Dispose()

  $out = Join-Path $dir $Name
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  "{0}  <-  {1} px" -f $Name, $Size
}

New-Icon 512  'icon-512.png'
New-Icon 192  'icon-192.png'
New-Icon 512  'icon-maskable-512.png'  -ContentScale 0.82
New-Icon 192  'icon-maskable-192.png'  -ContentScale 0.82
New-Icon 180  'apple-touch-icon.png'   -ContentScale 0.82
New-Icon 32   'favicon-32.png'
