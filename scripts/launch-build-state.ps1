function Test-SubsTranslateBuildRequired {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot
  )

  $requiredOutputs = @(
    (Join-Path $RepositoryRoot 'dist\index.html')
    (Join-Path $RepositoryRoot 'dist-electron\main\index.js')
    (Join-Path $RepositoryRoot 'dist-electron\preload\index.js')
  )

  foreach ($outputPath in $requiredOutputs) {
    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
      return $true
    }
  }

  $oldestOutputTime = ($requiredOutputs |
      ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } |
      Measure-Object -Minimum).Minimum

  $rootInputs = @(
    'index.html'
    'package.json'
    'package-lock.json'
    'tsconfig.json'
    'tsconfig.electron.json'
    'vite.config.ts'
  )

  foreach ($relativePath in $rootInputs) {
    $inputPath = Join-Path $RepositoryRoot $relativePath
    if ((Test-Path -LiteralPath $inputPath -PathType Leaf) -and
        (Get-Item -LiteralPath $inputPath).LastWriteTimeUtc -gt $oldestOutputTime) {
      return $true
    }
  }

  foreach ($relativeDirectory in @('src', 'public')) {
    $inputDirectory = Join-Path $RepositoryRoot $relativeDirectory
    if (-not (Test-Path -LiteralPath $inputDirectory -PathType Container)) {
      continue
    }

    foreach ($inputFile in Get-ChildItem -LiteralPath $inputDirectory -File -Recurse) {
      if ($inputFile.LastWriteTimeUtc -gt $oldestOutputTime) {
        return $true
      }
    }
  }

  return $false
}
