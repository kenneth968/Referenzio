$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$unpackedExecutable = Join-Path $repositoryRoot 'out\Referenzio-win32-x64\Referenzio.exe'
$installerDirectory = Join-Path $repositoryRoot 'out\make\squirrel.windows\x64'

if (-not (Test-Path -LiteralPath $unpackedExecutable -PathType Leaf)) {
  throw "Missing unpacked executable: $unpackedExecutable"
}

if (-not (Test-Path -LiteralPath $installerDirectory -PathType Container)) {
  throw "Missing Squirrel installer directory: $installerDirectory"
}

$installers = @(Get-ChildItem -LiteralPath $installerDirectory -Filter '*Setup.exe' -File)
if ($installers.Count -ne 1) {
  throw "Expected exactly one Squirrel setup executable in $installerDirectory; found $($installers.Count)."
}

Write-Output "Unpacked executable: $([System.IO.Path]::GetFullPath($unpackedExecutable))"
Write-Output "Squirrel installer: $($installers[0].FullName)"
