# 生成任务栏徽标：黑色圆牌 + 白色数字，输出 resources/taskbar/badge-1..9.png 和 badge-more.png（写作 9+）。
# 运行期由 src/main/taskbar.ts 通过 setOverlayIcon 挂到 Windows 任务栏按钮右下角。
# 尺寸取 32px：Windows 会按 DPI 缩到 16px 上下，给大一倍的原图比 16px 直接放大更干净。
# 注意：本文件存成带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会把中文读成乱码。

Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
$Size = 32
$Plate = '#000000'
$Ink = '#ffffff'
$Out = Join-Path $Root 'resources/taskbar'

New-Item -ItemType Directory -Force -Path $Out | Out-Null

function New-DigitFont([single]$PixelSize, [System.Drawing.FontStyle]$Style) {
	try {
		$family = New-Object System.Drawing.FontFamily('Segoe UI Semibold')
		return New-Object System.Drawing.Font($family, $PixelSize, $Style, [System.Drawing.GraphicsUnit]::Pixel)
	} catch {
		$family = New-Object System.Drawing.FontFamily('Segoe UI')
		return New-Object System.Drawing.Font($family, $PixelSize, $Style, [System.Drawing.GraphicsUnit]::Pixel)
	}
}

# 一张徽标：整块画布填成黑圆牌，数字按墨迹居中（DrawString 的定位点是行盒，不是字）。
function New-BadgeBitmap([string]$Text, [single]$PixelSize) {
	$bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
	$graphics.Clear([System.Drawing.Color]::Transparent)

	$brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Plate))
	$graphics.FillEllipse($brush, 0, 0, $Size - 1, $Size - 1)
	$brush.Dispose()

	$font = New-DigitFont $PixelSize ([System.Drawing.FontStyle]::Bold)
	$ink = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Ink))
	$format = New-Object System.Drawing.StringFormat
	$format.Alignment = [System.Drawing.StringAlignment]::Center
	$format.LineAlignment = [System.Drawing.StringAlignment]::Center
	# 视觉重心比几何中心略高一点点，圆牌上看着才正中。
	$box = New-Object System.Drawing.RectangleF(0, -1, $Size, $Size)
	$graphics.DrawString($Text, $font, $ink, $box, $format)

	$ink.Dispose()
	$font.Dispose()
	$format.Dispose()
	$graphics.Dispose()
	return $bitmap
}

$written = @()
foreach ($n in 1..9) {
	$bitmap = New-BadgeBitmap "$n" 19
	$file = Join-Path $Out "badge-$n.png"
	$bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
	$bitmap.Dispose()
	$written += (Split-Path -Leaf $file)
}

# 10 以上画成 9+：两位数字在 32px 里挤不下，任务栏上一眼也认不出。
$more = New-BadgeBitmap '9+' 14
$moreFile = Join-Path $Out 'badge-more.png'
$more.Save($moreFile, [System.Drawing.Imaging.ImageFormat]::Png)
$more.Dispose()
$written += 'badge-more.png'

"badges written: $($written -join ', ')"
