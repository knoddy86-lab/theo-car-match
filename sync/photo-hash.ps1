# Perceptual hashes (64-bit dHash, hex) for small cached JPEGs. Read-only.
# Usage: photo-hash.ps1 <list.json>   (JSON array of full paths). Prints JSON {path: hash}.
param([string]$ListFile)
Add-Type -AssemblyName System.Drawing
$files = Get-Content -Raw -LiteralPath $ListFile | ConvertFrom-Json
$out = @{}
foreach ($f in $files) {
  try {
    $img = [System.Drawing.Image]::FromFile($f)
    $bmp = New-Object System.Drawing.Bitmap 9, 8
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $g.DrawImage($img, 0, 0, 9, 8)
    $g.Dispose(); $img.Dispose()
    $bits = New-Object System.Text.StringBuilder
    [UInt64]$h = 0
    for ($y = 0; $y -lt 8; $y++) {
      for ($x = 0; $x -lt 8; $x++) {
        $a = $bmp.GetPixel($x, $y); $b = $bmp.GetPixel($x + 1, $y)
        $la = 0.299 * $a.R + 0.587 * $a.G + 0.114 * $a.B
        $lb = 0.299 * $b.R + 0.587 * $b.G + 0.114 * $b.B
        $h = $h -shl 1
        if ($la -gt $lb) { $h = $h -bor 1 }
      }
    }
    $bmp.Dispose()
    $out[$f] = $h.ToString("x16")
  } catch { $out[$f] = "" }
}
$out | ConvertTo-Json -Compress
