param([string]$PlatformTools = "$env:LOCALAPPDATA\Android\Sdk\platform-tools", [string]$VersionName = "0.8.13", [int]$VersionCode = 30)
if ($VersionName -notmatch '^\d+\.\d+\.\d+$' -or $VersionCode -lt 1) { throw 'Invalid release version.' }
$ErrorActionPreference = 'Stop'
$SetupRepo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$SetupOutput = Join-Path $SetupRepo "artifacts\PrimeSecure-PC-Setup-$VersionName-StudentEnrollment"
$SetupCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$SetupProof = Get-Content -LiteralPath (Join-Path $SetupRepo "artifacts\verification-$VersionName-native.json") -Raw | ConvertFrom-Json
$SetupApk = Join-Path $SetupRepo "artifacts\primesecure-$VersionName-$VersionCode.apk"
if (!$SetupProof.signature_verified -or !$SetupProof.same_installed_fleet_signer -or $SetupProof.test_only -or $SetupProof.version_code -ne $VersionCode -or $SetupProof.version_name -ne $VersionName -or $SetupProof.debuggable) { throw 'The verified non-test-only APK is required.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $SetupApk).Hash.ToLowerInvariant() -ne $SetupProof.sha256) { throw 'APK differs from verification evidence.' }
New-Item -ItemType Directory -Path $SetupOutput,(Join-Path $SetupOutput 'tools'),(Join-Path $SetupOutput 'brand') -Force | Out-Null
Copy-Item -LiteralPath $SetupApk -Destination (Join-Path $SetupOutput 'PrimeSecure.apk') -Force
foreach ($SetupFile in @('adb.exe','AdbWinApi.dll','AdbWinUsbApi.dll','libwinpthread-1.dll','NOTICE.txt','source.properties')) {
    Copy-Item -LiteralPath (Join-Path $PlatformTools $SetupFile) -Destination (Join-Path $SetupOutput "tools\$SetupFile") -Force
}
Copy-Item -LiteralPath (Join-Path $SetupRepo 'dashboard\public\brand\robokorda.jpg') -Destination (Join-Path $SetupOutput 'brand\robokorda.jpg') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $SetupOutput 'READ ME.txt') -Force
$SetupPublicConfig = (& python (Join-Path $PSScriptRoot 'Read-PublicConfig.py') $SetupApk) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$SetupPublicConfig.anon) { throw 'Public API configuration could not be read from the verified APK.' }
$SetupEntries = @()
$SetupPayloadFiles=@('PrimeSecure.apk','READ ME.txt','brand\robokorda.jpg','tools\adb.exe','tools\AdbWinApi.dll','tools\AdbWinUsbApi.dll','tools\libwinpthread-1.dll','tools\NOTICE.txt','tools\source.properties')
foreach ($SetupPayloadFile in $SetupPayloadFiles) {
    $SetupFile=Get-Item -LiteralPath (Join-Path $SetupOutput $SetupPayloadFile)
    $SetupRelative=$SetupFile.FullName.Substring($SetupOutput.Length+1).Replace('\','\\').Replace('"','\"')
    $SetupDigest=(Get-FileHash -Algorithm SHA256 -LiteralPath $SetupFile.FullName).Hash.ToLowerInvariant()
    $SetupEntries += '            {"'+$SetupRelative+'","'+$SetupDigest+'"},'
}
$SetupVersion=@"
using System.Collections.Generic;
namespace PrimeSecureSetup {
    public static class Kit {
        public const string VersionName="$VersionName";
        public const int VersionCode=$VersionCode;
        public const string ApiUrl="$($SetupPublicConfig.url)";
        public const string AnonKey="$($SetupPublicConfig.anon)";
        public const string ApkFile="PrimeSecure.apk";
        public const string ApkSha256="$($SetupProof.sha256)";
        public static readonly Dictionary<string,string> Files=new Dictionary<string,string> {
$($SetupEntries -join "`r`n")
        };
    }
}
"@
$SetupGenerated=Join-Path $SetupRepo 'artifacts\PcSetupKit.cs'
[IO.File]::WriteAllText($SetupGenerated,$SetupVersion,(New-Object System.Text.UTF8Encoding($false)))
& $SetupCompiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$SetupOutput\PrimeSecure Setup.exe" "/win32manifest:$PSScriptRoot\app.manifest" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Core.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'AssemblyInfo.cs') (Join-Path $PSScriptRoot 'SetupCore.cs') (Join-Path $PSScriptRoot 'SetupCloud.cs') (Join-Path $PSScriptRoot 'SetupForm.cs') $SetupGenerated
if($LASTEXITCODE -ne 0){ throw 'Setup app compilation failed.' }
& $SetupCompiler /nologo /target:exe /platform:anycpu /optimize+ "/out:$SetupRepo\artifacts\PcSetupTests.exe" /reference:System.Core.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'SetupCore.cs') (Join-Path $PSScriptRoot 'SetupCloud.cs') (Join-Path $PSScriptRoot 'SetupTests.cs') $SetupGenerated
if($LASTEXITCODE -ne 0){ throw 'Setup test compilation failed.' }
& (Join-Path $SetupRepo 'artifacts\PcSetupTests.exe') $SetupOutput
if($LASTEXITCODE -ne 0){ throw 'Setup regression checks failed.' }
& $SetupCompiler /nologo /target:exe /platform:anycpu /optimize+ "/out:$SetupRepo\artifacts\PcSetupCloudTests.exe" /reference:System.Core.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'SetupCloud.cs') (Join-Path $PSScriptRoot 'SetupCloudTests.cs') $SetupGenerated
if($LASTEXITCODE -ne 0){ throw 'Cloud setup test compilation failed.' }
& (Join-Path $SetupRepo 'artifacts\PcSetupCloudTests.exe')
if($LASTEXITCODE -ne 0){ throw 'Cloud enrollment regression checks failed.' }
$SetupZip=Join-Path $SetupRepo "artifacts\PrimeSecure-PC-Setup-$VersionName-StudentEnrollment.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if(Test-Path -LiteralPath $SetupZip){Remove-Item -LiteralPath $SetupZip -Force}
$SetupArchive=[IO.Compression.ZipFile]::Open($SetupZip,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach($SetupPayloadFile in ($SetupPayloadFiles+@('PrimeSecure Setup.exe'))) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($SetupArchive,(Join-Path $SetupOutput $SetupPayloadFile),$SetupPayloadFile.Replace('\','/')) | Out-Null
    }
} finally {$SetupArchive.Dispose()}
Get-Item -LiteralPath $SetupZip | Select-Object FullName,Length
