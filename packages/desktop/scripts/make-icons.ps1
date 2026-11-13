# 生成桌面应用图标：GDI+ 按尺寸直接渲染 π 品牌标，输出 build/icon.png、build/icon.ico
# 和运行期用的 resources/icon.png。运行：npm run icons（在 packages/desktop 下）。
# 注意：本文件必须存成带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会把中文和 π 读成乱码。

Add-Type -AssemblyName System.Drawing

$Paper = '#ede4cf'
$Ink = '#1c1b18'
$GlyphRatio = 0.62
$RadiusRatio = 0.22

$Root = Split-Path -Parent $PSScriptRoot
$IcoSizes = @(16, 24, 32, 48, 64, 128, 256)
$MasterSize = 512
$ProbeSize = 256
$Work = Join-Path $env:TEMP 'pi-desktop-icons'

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'build'), (Join-Path $Root 'resources'), $Work | Out-Null

# 界面里的 π 是 600 字重，对应 Segoe UI Semibold；缺字体时退回 Segoe UI Bold。
function New-GlyphFont([single]$PixelSize) {
	try {
		$family = New-Object System.Drawing.FontFamily('Segoe UI Semibold')
		return New-Object System.Drawing.Font($family, $PixelSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
	} catch {
		$family = New-Object System.Drawing.FontFamily('Segoe UI')
		return New-Object System.Drawing.Font($family, $PixelSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
	}
}

# 每行内部的墨迹左右边界，用来求 π 实际的墨迹中心（DrawString 的定位点是行盒，不是字）。
function Get-InkBoundsX([System.Drawing.Bitmap]$Bitmap) {
	$rect = New-Object System.Drawing.Rectangle(0, 0, $Bitmap.Width, $Bitmap.Height)
	$data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$bytes = New-Object byte[] ($data.Stride * $Bitmap.Height)
	[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
	$Bitmap.UnlockBits($data)

	$minX = $Bitmap.Width; $maxX = -1; $minY = $Bitmap.Height; $maxY = -1
	for ($y = 0; $y -lt $Bitmap.Height; $y++) {
		$row = $y * $data.Stride
		for ($x = 0; $x -lt $Bitmap.Width; $x++) {
			if ($bytes[$row + $x * 4 + 3] -gt 40) {
				if ($x -lt $minX) { $minX = $x }
				if ($x -gt $maxX) { $maxX = $x }
				if ($y -lt $minY) { $minY = $y }
				if ($y -gt $maxY) { $maxY = $y }
			}
		}
	}
	return @{ CenterX = ($minX + $maxX) / 2; CenterY = ($minY + $maxY) / 2 }
}

# 先量一次 π 的墨迹中心，换算成相对字号的比例；各尺寸等比放缩后用同一比例居中。
$probeFont = New-GlyphFont([single]($ProbeSize * $GlyphRatio))
$probe = New-Object System.Drawing.Bitmap($ProbeSize, $ProbeSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$probeGraphics = [System.Drawing.Graphics]::FromImage($probe)
$probeGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$tight = New-Object System.Drawing.StringFormat([System.Drawing.StringFormat]::GenericTypographic)
$probeGraphics.DrawString('π', $probeFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.PointF(0, 0)), $tight)
$probeGraphics.Dispose()
$inkBounds = Get-InkBoundsX $probe
$probe.Dispose()
$probeFont.Dispose()
$InkCenterRatioX = $inkBounds.CenterX / ($ProbeSize * $GlyphRatio)
$InkCenterRatioY = $inkBounds.CenterY / ($ProbeSize * $GlyphRatio)
"ink center ratio: $([Math]::Round($InkCenterRatioX, 4)), $([Math]::Round($InkCenterRatioY, 4))"

function New-IconBitmap([int]$Size) {
	$bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
	$graphics.Clear([System.Drawing.Color]::Transparent)

	$radius = $Size * $RadiusRatio
	$diameter = $radius * 2
	$path = New-Object System.Drawing.Drawing2D.GraphicsPath
	$path.AddArc(0, 0, $diameter, $diameter, 180, 90)
	$path.AddArc($Size - $diameter, 0, $diameter, $diameter, 270, 90)
	$path.AddArc($Size - $diameter, $Size - $diameter, $diameter, $diameter, 0, 90)
	$path.AddArc(0, $Size - $diameter, $diameter, $diameter, 90, 90)
	$path.CloseFigure()
	$paperBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Paper))
	$graphics.FillPath($paperBrush, $path)
	$paperBrush.Dispose()
	$path.Dispose()

	$pixelSize = [single]($Size * $GlyphRatio)
	$font = New-GlyphFont($pixelSize)
	$inkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Ink))
	$origin = New-Object System.Drawing.PointF(
		[single]($Size / 2 - $InkCenterRatioX * $pixelSize),
		[single]($Size / 2 - $InkCenterRatioY * $pixelSize))
	$graphics.DrawString('π', $font, $inkBrush, $origin, $tight)

	$inkBrush.Dispose()
	$font.Dispose()
	$graphics.Dispose()
	return $bitmap
}

$pngs = @{}
foreach ($Size in @($MasterSize) + $IcoSizes) {
	$bitmap = New-IconBitmap $Size
	$file = Join-Path $Work "icon-$Size.png"
	$bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
	$bitmap.Dispose()
	$pngs[$Size] = [System.IO.File]::ReadAllBytes($file)
}

# ICO：每个尺寸一张 PNG 负载（Vista 起 shell 支持），字段全部小端
$header = [byte[]](0, 0, 1, 0, [byte]($IcoSizes.Count -band 0xFF), [byte](($IcoSizes.Count -shr 8) -band 0xFF))
$directory = New-Object System.Collections.Generic.List[byte]
$offset = $header.Length + 16 * $IcoSizes.Count
foreach ($Size in $IcoSizes) {
	$bytes = $pngs[$Size]
	$dim = if ($Size -ge 256) { 0 } else { $Size }
	$directory.AddRange([byte[]]@(
		[byte]$dim, [byte]$dim, [byte]0, [byte]0,
		[byte]1, [byte]0, [byte]32, [byte]0,
		[byte]($bytes.Length -band 0xFF), [byte](($bytes.Length -shr 8) -band 0xFF),
		[byte](($bytes.Length -shr 16) -band 0xFF), [byte](($bytes.Length -shr 24) -band 0xFF),
		[byte]($offset -band 0xFF), [byte](($offset -shr 8) -band 0xFF),
		[byte](($offset -shr 16) -band 0xFF), [byte](($offset -shr 24) -band 0xFF)
	))
	$offset += $bytes.Length
}

$ico = New-Object System.Collections.Generic.List[byte]
$ico.AddRange($header)
$ico.AddRange($directory)
foreach ($Size in $IcoSizes) { $ico.AddRange([byte[]]$pngs[$Size]) }

$icoPath = Join-Path $Root 'build/icon.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
[System.IO.File]::WriteAllBytes((Join-Path $Root 'build/icon.png'), [byte[]]$pngs[$MasterSize])
[System.IO.File]::WriteAllBytes((Join-Path $Root 'resources/icon.png'), [byte[]]$pngs[256])

"icons written: $MasterSize, $($IcoSizes -join ', ')"
"ico bytes: $((Get-Item $icoPath).Length)"
