# 生成通知身份图标：白底 + 黑色 π 线条，输出 resources/notification-icon.png。
# 这颗图挂在 Windows 通知的 AUMID 注册项上（见 src/main/identity.ts），显示在 toast 标题栏与通知中心。
# 与应用图标（make-icons.ps1 的奶油纸底）分开：通知里那颗要更小、更黑，白底在浅色通知面板上最干净。
# 注意：本文件存成带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会把中文读成乱码。

Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $PSScriptRoot
# 128 够系统缩到 16–24px 用；再大只是白占字节。
$Size = 128
$GlyphRatio = 0.74
$RadiusRatio = 0.22
$Paper = '#ffffff'
$Ink = '#000000'

function New-InkFont([single]$PixelSize) {
	try {
		$family = New-Object System.Drawing.FontFamily('Segoe UI Semibold')
		return New-Object System.Drawing.Font($family, $PixelSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
	} catch {
		$family = New-Object System.Drawing.FontFamily('Segoe UI')
		return New-Object System.Drawing.Font($family, $PixelSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
	}
}

$bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)

# 圆角白底：与桌面图标同一套形状，只是换了颜色。
$radius = $Size * $RadiusRatio
$diameter = $radius * 2
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $diameter, $diameter, 180, 90)
$path.AddArc($Size - $diameter, 0, $diameter, $diameter, 270, 90)
$path.AddArc($Size - $diameter, $Size - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(0, $Size - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()
$paper = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Paper))
$graphics.FillPath($paper, $path)
$paper.Dispose()
$path.Dispose()

# 黑色 π：按墨迹居中（DrawString 的定位点是行盒，不是字），视觉重心略微上提一格像素。
$font = New-InkFont ([single]($Size * $GlyphRatio))
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($Ink))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$box = New-Object System.Drawing.RectangleF(0, -1, $Size, $Size)
$graphics.DrawString('π', $font, $ink, $box, $format)

$ink.Dispose()
$font.Dispose()
$format.Dispose()
$graphics.Dispose()

$target = Join-Path $Root 'resources/notification-icon.png'
$bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

"notification icon written: $target ($((Get-Item $target).Length) bytes, $Size x $Size)"
