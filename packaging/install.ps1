[CmdletBinding()]
param(
  [string]$Version = $(if ($env:AGENVYL_VERSION) { $env:AGENVYL_VERSION } else { 'latest' }),
  [switch]$NoPath,
  [switch]$NoLaunch,
  [string]$ManifestUrl = $env:AGENVYL_MANIFEST_URL,
  [string]$InstallRoot = $env:AGENVYL_INSTALL_ROOT,
  [string]$Repository = $(if ($env:AGENVYL_REPOSITORY) { $env:AGENVYL_REPOSITORY } else { 'riffi/agenvyl' })
)

$ErrorActionPreference = 'Stop'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  }
  finally { $stream.Dispose() }
}
if ($Version -notmatch '^[0-9A-Za-z._-]+$') { throw 'Invalid Agenvyl version.' }
if ([Environment]::Is64BitOperatingSystem -eq $false -or $env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'x86')) { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }
$target = 'windows-x64'

if (-not $ManifestUrl) {
  $ManifestUrl = if ($Version -eq 'latest') { "https://github.com/$Repository/releases/latest/download/agenvyl-release.txt" } else { "https://github.com/$Repository/releases/download/v$Version/agenvyl-release.txt" }
}
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA 'Agenvyl\versions' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("agenvyl-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null

try {
  $indexFile = Join-Path $temporary 'agenvyl-release.txt'
  Invoke-WebRequest -UseBasicParsing -Uri $ManifestUrl -OutFile $indexFile
  $lines = Get-Content -LiteralPath $indexFile
  if ($lines[0] -ne 'agenvyl-release-index-v1') { throw 'Unsupported Agenvyl release index.' }
  $releaseVersion = $null
  $release = $null
  foreach ($line in $lines) {
    $fields = $line -split "`t"
    if ($fields[0] -eq 'version') { $releaseVersion = $fields[1] }
    if ($fields[0] -eq 'target' -and $fields[1] -eq $target) {
      $release = [pscustomobject]@{ Filename=$fields[2]; Format=$fields[3]; Size=$fields[4]; Sha256=$fields[5]; Url=$fields[6] }
    }
  }
  if (-not $releaseVersion -or -not $release) { throw "Release does not contain target $target." }
  if ($releaseVersion -notmatch '^[0-9A-Za-z._-]+$' -or $release.Filename -notmatch '^[0-9A-Za-z._-]+$') { throw 'Release index contains unsafe values.' }
  if ($release.Size -notmatch '^\d+$' -or $release.Sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Release index contains invalid integrity metadata.' }
  if (([uri]$release.Url).Scheme -ne 'https') { throw 'Release archive URL must use HTTPS.' }
  if ($Version -ne 'latest' -and $Version -ne $releaseVersion) { throw "Requested version $Version, index contains $releaseVersion." }

  $archive = Join-Path $temporary $release.Filename
  Invoke-WebRequest -UseBasicParsing -Uri $release.Url -OutFile $archive
  if ((Get-Item -LiteralPath $archive).Length -ne [long]$release.Size) { throw 'Archive size mismatch.' }
  if ((Get-Sha256 $archive) -ne $release.Sha256) { throw 'Archive checksum mismatch.' }
  if ($release.Format -ne 'zip') { throw "Unsupported Windows archive format: $($release.Format)" }

  $extracted = Join-Path $temporary 'extracted'
  New-Item -ItemType Directory -Path $extracted | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  & $tar -xf $archive -C $extracted
  if ($LASTEXITCODE -ne 0) { throw 'Unable to extract the Agenvyl archive.' }
  $entries = @(Get-ChildItem -LiteralPath $extracted)
  if ($entries.Count -ne 1 -or -not $entries[0].PSIsContainer) { throw 'Unexpected Agenvyl archive layout.' }
  $bundle = $entries[0].FullName
  if (-not (Test-Path -LiteralPath (Join-Path $bundle 'manifest.json')) -or -not (Test-Path -LiteralPath (Join-Path $bundle 'bin\agenvyl.cmd'))) { throw 'Agenvyl archive is incomplete.' }

  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  $destination = Join-Path $InstallRoot $releaseVersion
  $staged = Join-Path $InstallRoot (".agenvyl-$releaseVersion-new-" + $PID)
  $previous = Join-Path $InstallRoot (".agenvyl-$releaseVersion-previous-" + $PID)
  $commandPath = if ($env:AGENVYL_USER_BIN_DIR) { Join-Path $env:AGENVYL_USER_BIN_DIR 'agenvyl.cmd' } else { Join-Path $env:LOCALAPPDATA 'Agenvyl\bin\agenvyl.cmd' }
  $oldBundle = if (Test-Path -LiteralPath $commandPath) { (Select-String -LiteralPath $commandPath -Pattern '^rem Agenvyl bundle: (.+)$').Matches.Groups[1].Value } else { $null }

  Move-Item -LiteralPath $bundle -Destination $staged
  if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $previous }
  Move-Item -LiteralPath $staged -Destination $destination
  $pathPolicy = if ($NoPath -or $env:AGENVYL_NO_PATH -eq '1') { 'none' } else { 'user' }
  $bundleCommand = Join-Path $destination 'bin\agenvyl.cmd'
  Write-Host "Preparing Agenvyl $releaseVersion for first use..."
  $null = @(& $bundleCommand init --locale en --shortcuts recommended --path $pathPolicy --json)
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $destination -Recurse -Force
    if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $destination }
    throw 'Agenvyl initialization failed; the previous installation was restored.'
  }
  if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }

  function Test-OwnedVersionDirectory([string]$Candidate) {
    if (-not $Candidate) { return $false }
    $resolved = [IO.Path]::GetFullPath($Candidate)
    $prefix = $InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    return $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath (Join-Path $resolved 'manifest.json'))
  }
  if ($pathPolicy -eq 'user' -and $oldBundle -and $oldBundle -ne $destination -and (Test-OwnedVersionDirectory $oldBundle)) { Remove-Item -LiteralPath $oldBundle -Recurse -Force }
  $setupComplete = $false
  if (-not $NoLaunch -and $env:AGENVYL_NO_LAUNCH -ne '1') {
    Write-Host 'Starting Agenvyl and detecting available coding agents...'
    $null = @(& $bundleCommand setup --all --json)
    if ($LASTEXITCODE -eq 0) { $setupComplete = $true }
    else { Write-Warning "Agenvyl was installed, but initial setup did not finish. Run '$bundleCommand setup --all' to retry." }
  }
  if ($setupComplete) {
    Write-Host "Agenvyl $releaseVersion is installed and ready."
  } else {
    Write-Host "Agenvyl $releaseVersion installed at $destination"
    if ($NoLaunch -or $env:AGENVYL_NO_LAUNCH -eq '1') { Write-Host "Automatic startup was skipped. Run '$bundleCommand setup --all' to finish setup." }
  }
  if ($pathPolicy -eq 'user') { Write-Host 'Open a new terminal to use the agenvyl command.' }
}
finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
