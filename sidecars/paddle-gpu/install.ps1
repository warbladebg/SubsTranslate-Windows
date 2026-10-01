[CmdletBinding()]
param(
    [string]$PythonLauncher = "py"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sidecarRoot = $PSScriptRoot
$venvRoot = Join-Path $sidecarRoot ".venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$modelCache = Join-Path $sidecarRoot "models\.paddlex"
$requirements = Join-Path $sidecarRoot "requirements.txt"

function Assert-LastCommand {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    if ($PythonLauncher -eq "py") {
        & py -3.12 -m venv $venvRoot
    }
    else {
        & $PythonLauncher -m venv $venvRoot
    }
    Assert-LastCommand "Python virtual-environment creation"
}

& $venvPython -m pip install --upgrade pip
Assert-LastCommand "pip upgrade"

$paddleVersion = & $venvPython -c "import importlib.metadata; print(importlib.metadata.version('paddlepaddle-gpu'))" 2>$null
if ($LASTEXITCODE -ne 0 -or $paddleVersion.Trim() -ne "3.2.2") {
    & $venvPython -m pip install paddlepaddle-gpu==3.2.2 --index-url https://www.paddlepaddle.org.cn/packages/stable/cu126/
    Assert-LastCommand "PaddlePaddle CUDA installation"
}

& $venvPython -m pip install --requirement $requirements
Assert-LastCommand "GPU OCR dependency installation"

# Paddle 3.2.2's package metadata pins cuDNN 9.5, while its Windows CUDA
# binary reports that it was compiled against cuDNN 9.9. Install the matching
# runtime after dependency resolution and avoid asking pip to re-resolve Paddle.
$cudnnVersion = & $venvPython -c "import importlib.metadata; print(importlib.metadata.version('nvidia-cudnn-cu12'))" 2>$null
if ($LASTEXITCODE -ne 0 -or $cudnnVersion.Trim() -ne "9.9.0.52") {
    & $venvPython -m pip install --upgrade --no-deps nvidia-cudnn-cu12==9.9.0.52
    Assert-LastCommand "cuDNN 9.9 runtime installation"
}

$env:PADDLE_PDX_CACHE_HOME = $modelCache
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"
$bootstrap = @"
import paddle
import importlib.metadata
from paddleocr import TextRecognition

if not paddle.device.is_compiled_with_cuda():
    raise RuntimeError('Installed PaddlePaddle build does not include CUDA')
paddle.set_device('gpu:0')
TextRecognition(model_name='PP-OCRv6_medium_rec', device='gpu:0')
cudnn_version = importlib.metadata.version('nvidia-cudnn-cu12')
print(
    f'GPU OCR ready: Paddle {paddle.__version__}, '
    f'cuDNN {cudnn_version}, '
    f'device {paddle.device.get_device()}'
)
"@

& $venvPython -c $bootstrap
Assert-LastCommand "GPU and PP-OCRv6 verification"

Write-Output "Local GPU OCR installation completed under: $sidecarRoot"
