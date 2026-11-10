# Resizes cached family photos for Theo's Car Match. Input: a JSON job list.
param([string]$JobFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$jobs = Get-Content -Raw -Path $JobFile | ConvertFrom-Json
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$ok = 0; $bad = 0
foreach ($j in $jobs) {
  try {
    $img = [System.Drawing.Image]::FromFile($j.in)
    try {
      if ($j.orient -and ($img.PropertyIdList -contains 0x0112)) {
        $o = [int]$img.GetPropertyItem(0x0112).Value[0]
        switch ($o) {
          2 { $img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
          3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
          4 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
          5 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
          6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
          7 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
          8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
        }
      }
      $iw = $img.Width; $ih = $img.Height
      if ($j.crop) {
        $sx = [int][Math]::Round($j.crop.x * $iw); $sy = [int][Math]::Round($j.crop.y * $ih)
        $sw = [int][Math]::Round($j.crop.w * $iw); $sh = [int][Math]::Round($j.crop.h * $ih)
      } else { $sx = 0; $sy = 0; $sw = $iw; $sh = $ih }
      if ($sw -lt 1) { $sw = 1 }; if ($sh -lt 1) { $sh = 1 }
      $scale = [Math]::Min(1.0, [double]$j.size / [Math]::Max($sw, $sh))
      $dw = [int][Math]::Max(1, [Math]::Round($sw * $scale)); $dh = [int][Math]::Max(1, [Math]::Round($sh * $scale))
      $bmp = New-Object System.Drawing.Bitmap($dw, $dh)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $attr = New-Object System.Drawing.Imaging.ImageAttributes
      $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $dw, $dh)), $sx, $sy, $sw, $sh, [System.Drawing.GraphicsUnit]::Pixel, $attr)
      $g.Dispose()
      $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$j.quality)
      $bmp.Save($j.out, $codec, $ep)
      $bmp.Dispose()
      $ok++
    } finally { $img.Dispose() }
  } catch { $bad++; [Console]::Error.WriteLine("skip: " + $_.Exception.Message) }
}
Write-Output "resized $ok, skipped $bad"
