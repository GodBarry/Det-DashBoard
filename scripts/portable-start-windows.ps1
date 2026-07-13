param(
  [string]$ComposeEnvFile = ".env.portable"
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

if (Test-Path $ComposeEnvFile) {
  Get-Content $ComposeEnvFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $name = $matches[1]
      $value = $matches[2].Trim().Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }
}

New-Item -ItemType Directory -Force -Path `
  "datasets", "exports", "portable-data", "portable-data\storage", "portable-data\postgres", "portable-data\minio", "portable-data\host-browse-root" | Out-Null

if (-not $env:APP_PORT) { $env:APP_PORT = "5173" }
if (-not $env:APP_IMAGE) { $env:APP_IMAGE = "det-dashboard:local" }
if (-not $env:DATASETS_DIR) { $env:DATASETS_DIR = (Join-Path $RootDir "datasets") }
if (-not $env:DATA_ROOT_DISPLAY) { $env:DATA_ROOT_DISPLAY = $env:DATASETS_DIR }
if (-not $env:BROWSE_ROOT_DISPLAY) { $env:BROWSE_ROOT_DISPLAY = "/" }
if (-not $env:HOST_BROWSE_ROOT) { $env:HOST_BROWSE_ROOT = (Join-Path $RootDir "portable-data\host-browse-root") }
if (-not $env:APP_STORAGE_DIR) { $env:APP_STORAGE_DIR = (Join-Path $RootDir "portable-data\storage") }
if (-not $env:POSTGRES_DATA_DIR) { $env:POSTGRES_DATA_DIR = (Join-Path $RootDir "portable-data\postgres") }
if (-not $env:MINIO_DATA_DIR) { $env:MINIO_DATA_DIR = (Join-Path $RootDir "portable-data\minio") }
if (-not $env:EXPORTS_DIR) { $env:EXPORTS_DIR = (Join-Path $RootDir "exports") }
if (-not $env:EXPORT_ROOT_DISPLAY) { $env:EXPORT_ROOT_DISPLAY = $env:EXPORTS_DIR }
if (-not $env:LOCAL_UID) { $env:LOCAL_UID = "1000" }
if (-not $env:LOCAL_GID) { $env:LOCAL_GID = "1000" }
$env:HOST_PATH_MODE = "windows"
$env:HOST_DIALOG_URL = "http://127.0.0.1:4178"
$env:NATIVE_DIALOG_MODE = "bridge"
$env:FOLDER_DIALOG_ALLOWED_ORIGINS = "http://localhost:$($env:APP_PORT),http://127.0.0.1:$($env:APP_PORT)"

$overridePath = Join-Path $RootDir "portable-data\windows-drives.override.yml"
$driveLines = @(
  "services:",
  "  app:",
  "    volumes:"
)
Get-PSDrive -PSProvider FileSystem |
  Where-Object { $_.Root -match '^[A-Za-z]:\\$' } |
  Sort-Object Name |
  ForEach-Object {
    $letter = $_.Name.ToUpperInvariant()
    $driveLines += "      - '$($letter):\:/host/browse/$($letter):ro'"
  }
Set-Content -Path $overridePath -Value $driveLines -Encoding UTF8

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warning "Node.js is required for the native Windows folder dialog bridge."
} else {
  $pidFile = Join-Path $RootDir "portable-data\folder-dialog.pid"
  $logFile = Join-Path $RootDir "portable-data\folder-dialog.log"
  $errLogFile = Join-Path $RootDir "portable-data\folder-dialog.err.log"
  $running = $false
  if (Test-Path $pidFile) {
    $oldPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid) {
      $running = [bool](Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue)
    }
  }
  if (-not $running) {
    $process = Start-Process -FilePath $node.Source -ArgumentList "`"$RootDir\scripts\folder-dialog-bridge.js`"" -WorkingDirectory $RootDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile
    Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII
    Start-Sleep -Milliseconds 300
  }
}

$composeArgs = @("compose", "-f", "docker-compose.portable.yml", "-f", $overridePath, "up")
if ($env:BUILD_LOCAL_IMAGE -eq "false") {
  $composeArgs += @("--no-build")
} else {
  $composeArgs += @("--build")
}
$composeArgs += @("-d", "--wait")

docker @composeArgs

Write-Host "Det-DashBoard is running at http://localhost:$($env:APP_PORT)"
Write-Host "Windows drives mounted read-only under /host/browse/<drive-letter>."
Write-Host "Exports are written to $($env:EXPORTS_DIR)"
Write-Host "Native folder dialog bridge: $($env:HOST_DIALOG_URL)"
