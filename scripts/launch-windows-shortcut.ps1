[CmdletBinding()]
param(
  [switch]$ForceBuild
)

$ErrorActionPreference = 'Stop'

try {
  $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $electronPath = Join-Path $repositoryRoot 'node_modules\electron\dist\electron.exe'

  if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
    throw 'Electron is not installed. Run npm install in the SubsTranslate folder first.'
  }

  $buildStateHelper = Join-Path $PSScriptRoot 'launch-build-state.ps1'
  if (-not (Test-Path -LiteralPath $buildStateHelper -PathType Leaf)) {
    throw 'The launch build-state helper is missing.'
  }
  . $buildStateHelper

  if ($ForceBuild -or (Test-SubsTranslateBuildRequired -RepositoryRoot $repositoryRoot)) {
    Push-Location $repositoryRoot
    try {
      & npm.cmd run build
      if ($LASTEXITCODE -ne 0) {
        throw "The SubsTranslate build exited with code $LASTEXITCODE."
      }
    }
    finally {
      Pop-Location
    }
  }

  Start-Process -FilePath $electronPath -ArgumentList "`"$repositoryRoot`"" -WorkingDirectory $repositoryRoot
}
catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "SubsTranslate could not start.`n`n$($_.Exception.Message)",
    'SubsTranslate',
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
}
