param([string]$JavaHome='C:\Program Files\Android\Android Studio\jbr')
$ErrorActionPreference='Stop'
$catalogTemp=Join-Path $env:TEMP 'primesecure-catalog-refresh'
New-Item -ItemType Directory -Path $catalogTemp -Force | Out-Null
Invoke-WebRequest 'https://f-droid.org/repo/entry.jar' -OutFile (Join-Path $catalogTemp 'entry.jar')
& (Join-Path $JavaHome 'bin\java.exe') (Join-Path $PSScriptRoot 'VerifyFdroid.java') (Join-Path $catalogTemp 'entry.jar') (Join-Path $catalogTemp 'entry.json')
if($LASTEXITCODE-ne 0){throw 'Repository signature verification failed'}
Invoke-WebRequest 'https://f-droid.org/repo/index-v2.json' -OutFile (Join-Path $catalogTemp 'index-v2.json')
node (Join-Path $PSScriptRoot 'build-app-catalog.cjs') (Join-Path $catalogTemp 'entry.json') (Join-Path $catalogTemp 'index-v2.json')
if($LASTEXITCODE-ne 0){throw 'Repository checksum verification failed'}
