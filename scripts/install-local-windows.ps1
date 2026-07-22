[CmdletBinding()]
param(
  [string]$ArchivePath,
  [switch]$NoPath,
  [switch]$NoLaunch,
  [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $repositoryRoot 'package.json') | ConvertFrom-Json
$version = [string]$packageJson.version
$filename = "agenvyl-$version-windows-x64.zip"

function Get-LocalSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  }
  finally { $stream.Dispose() }
}

if (-not $ArchivePath) { $ArchivePath = Join-Path $repositoryRoot "artifacts\portable\$filename" }
$ArchivePath = [IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw "Local Windows bundle not found: $ArchivePath. Run 'npm run bundle' first." }
if ([IO.Path]::GetFileName($ArchivePath) -ne $filename) { throw "Expected bundle filename $filename, got $([IO.Path]::GetFileName($ArchivePath))." }

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("agenvyl-local-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null

try {
  $indexPath = Join-Path $temporary 'agenvyl-release.txt'
  $archiveInfo = Get-Item -LiteralPath $ArchivePath
  $sha256 = Get-LocalSha256 $ArchivePath
  $archiveUrl = "https://agenvyl.local/$filename"
  $index = @(
    'agenvyl-release-index-v1'
    "version`t$version"
    'channel`tlocal'
    "target`twindows-x64`t$filename`tzip`t$($archiveInfo.Length)`t$sha256`t$archiveUrl"
  ) -join "`n"
  [IO.File]::WriteAllText($indexPath, "$index`n", [Text.UTF8Encoding]::new($false))

  function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    $requestedFile = [IO.Path]::GetFileName(([uri]$Uri).AbsolutePath)
    if ($requestedFile -eq 'agenvyl-release.txt') {
      Copy-Item -LiteralPath $indexPath -Destination $OutFile
      return
    }
    if ($requestedFile -eq $filename) {
      Copy-Item -LiteralPath $ArchivePath -Destination $OutFile
      return
    }
    throw "Unexpected local installer request: $Uri"
  }

  $installerArguments = @{
    Version = $version
    ManifestUrl = 'https://agenvyl.local/agenvyl-release.txt'
  }
  if ($NoPath) { $installerArguments.NoPath = $true }
  if ($NoLaunch) { $installerArguments.NoLaunch = $true }
  if ($InstallRoot) { $installerArguments.InstallRoot = $InstallRoot }

  & (Join-Path $repositoryRoot 'packaging\install.ps1') @installerArguments
}
finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
