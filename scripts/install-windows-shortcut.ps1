[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'The SubsTranslate Start Menu shortcut can only be installed on Windows.'
}

$launcherPath = (Resolve-Path (Join-Path $PSScriptRoot 'launch-windows-shortcut.ps1')).Path
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electronPath = Join-Path $repositoryRoot 'node_modules\electron\dist\electron.exe'
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$programsDirectory = [Environment]::GetFolderPath('Programs')
$shortcutPath = Join-Path $programsDirectory 'SubsTranslate.lnk'

if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  throw 'Electron is not installed. Run npm install before installing the shortcut.'
}

# The torrent engine is optional: everything else works without Python.
$torrentVendor = Join-Path $repositoryRoot 'sidecars\libtorrent\vendor\libtorrent'
if (-not (Test-Path -LiteralPath $torrentVendor -PathType Container)) {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  $installed = $false
  if ($python) {
    & npm.cmd run setup:torrent --prefix $repositoryRoot
    $installed = $LASTEXITCODE -eq 0
  }
  if (-not $installed) {
    Write-Warning ('In-app torrent downloads are unavailable until Python 3.12 is installed. ' +
      'Install it from python.org with "Add python.exe to PATH" ticked, then run npm run setup:torrent. ' +
      'Everything else in SubsTranslate works without it.')
  }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcherPath`""
$shortcut.Description = 'Open the Bulgarian Subtitle Translator'
$shortcut.IconLocation = "$electronPath,0"
$shortcut.WorkingDirectory = $repositoryRoot
$shortcut.Save()

Write-Output "Installed the SubsTranslate shortcut at $shortcutPath"
