param([string]$Destination = 'C:\Users\XO\Desktop\Prime Secure\App Packages')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Destination)
if ($root -ne 'C:\Users\XO\Desktop\Prime Secure\App Packages') { throw 'Use the dedicated App Packages backup destination.' }
New-Item -ItemType Directory -Path $root -Force | Out-Null
$shell = New-Object -ComObject Shell.Application
$phone = @($shell.Namespace(17).Items()) | Where-Object Name -eq 'Pixel 6 Pro'
if (-not $phone) { throw 'Connect and unlock Pixel 6 Pro, then enable USB file transfer.' }
$storage = $phone.GetFolder().ParseName('Internal shared storage')
if (-not $storage) { throw 'Unlock the phone to access internal shared storage.' }
$share = $storage.GetFolder().ParseName('SHAREit')
if (-not $share) { throw 'SHAREit folder not found.' }
$apps = $share.GetFolder().ParseName('apps')
if (-not $apps) { throw 'SHAREit/apps folder not found.' }
$report = [Collections.Generic.List[object]]::new()
foreach ($folder in @($apps.GetFolder().Items())) {
  if (-not $folder.IsFolder) { continue }
  if ($folder.Name -match '[\\/:*?"<>|]' -or $folder.Name -in @('.', '..')) { throw "Unsafe folder name: $($folder.Name)" }
  $target = Join-Path $root $folder.Name
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  $namespace = $shell.Namespace($target)
  foreach ($source in @($folder.GetFolder().Items())) {
    if ($source.IsFolder) { throw "Unexpected nested folder in $($folder.Name); no files removed." }
    if ($source.Name -match '[\\/:*?"<>|]' -or $source.Name -in @('.', '..')) { throw 'Unsafe file name.' }
    $size = [long]$source.ExtendedProperty('System.Size')
    if ($size -le 0) { throw "Source has no readable size: $($folder.Name)/$($source.Name)" }
    $path = Join-Path $target $source.Name
    if (Test-Path -LiteralPath $path) {
      if ((Get-Item -LiteralPath $path).Length -ne $size) { throw "Incomplete existing backup: $path. Keep it for investigation and use a fresh backup destination." }
    } else {
      $namespace.CopyHere($source, 1556)
      $deadline = [DateTime]::UtcNow.AddMinutes(12)
      $complete = $false
      while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        if ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -eq $size) {
          try {
            $stream = [IO.File]::Open($path, 'Open', 'Read', 'None')
            $stream.Dispose(); $complete = $true; break
          } catch { }
        }
      }
      if (-not $complete) { throw "Phone copy timed out: $path. No phone files were removed." }
    }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $report.Add([pscustomobject]@{App=$folder.Name;File=$source.Name;Bytes=$size;SHA256=$hash})
  }
  Write-Output "Copied and size-checked: $($folder.Name) ($(@($folder.GetFolder().Items()).Count) files)"
  $report | Export-Csv -LiteralPath (Join-Path $root 'backup-inventory.csv') -NoTypeInformation -Encoding UTF8
}
Write-Output "Complete: $($report.Count) files; $((($report | Measure-Object Bytes -Sum).Sum)) bytes. Originals and old base-only copies retained."
