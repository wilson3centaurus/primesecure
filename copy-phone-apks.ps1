$ErrorActionPreference = 'Stop'
$dest = 'C:\Users\XO\Downloads\PrimeSecure-APPS'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$shell = New-Object -ComObject Shell.Application
$pc = $shell.Namespace(17)
$phone = $pc.Items() | Where-Object Name -eq 'Pixel 6 Pro'
$storage = $phone.GetFolder().ParseName('Internal shared storage')
$share = $storage.GetFolder().ParseName('SHAREit')
$apps = $share.GetFolder().ParseName('apps')
$destNs = $shell.Namespace($dest)
$results = @()
foreach ($entry in @($apps.GetFolder().Items())) {
    if (-not $entry.IsFolder) { continue }
    $base = @($entry.GetFolder().Items()) | Where-Object { $_.Name -ieq 'base.apk' } | Select-Object -First 1
    if (-not $base) { $results += [PSCustomObject]@{ App = $entry.Name; Status = 'SKIP: base.apk not found' }; continue }
    $target = Join-Path $dest ($entry.Name + '.apk')
    if (Test-Path -LiteralPath $target) { continue }
    if (Test-Path -LiteralPath (Join-Path $dest 'base.apk')) { Move-Item -LiteralPath (Join-Path $dest 'base.apk') -Destination $target -Force; continue }
    if (Test-Path -LiteralPath (Join-Path $dest 'base.apk')) { Remove-Item -LiteralPath (Join-Path $dest 'base.apk') -Force }
    $destNs.CopyHere($base, 16)
    $copied = Join-Path $dest 'base.apk'
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-Path -LiteralPath $copied) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $copied) { Move-Item -LiteralPath $copied -Destination $target -Force; $results += [PSCustomObject]@{ App = $entry.Name; Status = 'COPIED' } }
    else { $results += [PSCustomObject]@{ App = $entry.Name; Status = 'FAILED: copy timeout' } }
}
$results | Group-Object Status | Select-Object Name, Count | Format-Table -AutoSize
$results | Where-Object Status -ne 'COPIED' | Format-Table -AutoSize
Write-Output "Destination APK count: $((Get-ChildItem -LiteralPath $dest -Filter '*.apk' -File).Count)"
