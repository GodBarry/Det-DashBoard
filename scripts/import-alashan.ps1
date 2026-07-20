$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:4177'
$sourceRoot = 'H:\ZBH\阿拉善数据合并'
$login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ username='admin'; password='admin' } | ConvertTo-Json)
$headers = @{ Authorization = ('Bearer ' + $login.token) }

function Get-Projects { (Invoke-RestMethod -Uri "$base/api/projects" -Headers $headers).projects }
function Ensure-Project($name, $parentId) {
  $existing = (Get-Projects | Where-Object { $_.name -eq $name -and $_.parent_id -eq $parentId } | Select-Object -First 1)
  if ($existing) { return $existing }
  return (Invoke-RestMethod -Uri "$base/api/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name=$name; parentId=$parentId; project_type='dataset'; visibility='private' } | ConvertTo-Json)).project
}
function Wait-Import($batchId) {
  do {
    Start-Sleep -Seconds 10
    $sql = "SELECT status,total_files,processed_files,message FROM import_batches WHERE id='$batchId';"
    $row = & 'C:\Users\14226\AppData\Local\Programs\Podman\podman.exe' exec det-dashboard-postgres psql -U det -d det_dashboard -At -F '|' -c $sql
    $parts = $row -split '\|', 4
    if ($parts.Count -ge 4) { Write-Host "[$($parts[0])] $($parts[2])/$($parts[1]) $($parts[3])" }
  } while ($parts.Count -lt 1 -or $parts[0] -in @('scanning','running'))
  if ($parts[0] -ne 'done') { throw "Import $batchId ended with status $($parts[0])" }
}

$rootName = (Get-Item -LiteralPath $sourceRoot).Name
$root = (Get-Projects | Where-Object { $_.name -eq $rootName -and -not $_.parent_id } | Select-Object -First 1)
if (-not $root) {
  $root = (Invoke-RestMethod -Uri "$base/api/projects" -Method Post -Headers $headers -ContentType 'application/json' -Body (@{ name=$rootName; description=$sourceRoot; project_type='dataset'; visibility='private' } | ConvertTo-Json)).project
}

foreach ($sceneDir in (Get-ChildItem -LiteralPath $sourceRoot -Directory)) {
  if ($sceneDir.Name -eq '审计报告') { continue }
  $sceneProject = Ensure-Project $sceneDir.Name $root.id
  foreach ($modalityDir in (Get-ChildItem -LiteralPath $sceneDir.FullName -Directory)) {
    $source = $modalityDir.FullName
    if (-not (Test-Path (Join-Path $source 'images'))) { continue }
    $project = Ensure-Project $modalityDir.Name $sceneProject.id
    $sql = "SELECT id,status FROM import_batches WHERE project_id='$($project.id)' AND deleted_at IS NULL AND status IN ('scanning','running') ORDER BY created_at DESC LIMIT 1;"
    $active = & 'C:\Users\14226\AppData\Local\Programs\Podman\podman.exe' exec det-dashboard-postgres psql -U det -d det_dashboard -At -F '|' -c $sql
    if ($active) { $batchId = ($active -split '\|')[0]; Wait-Import $batchId; continue }
    $doneSql = "SELECT id FROM import_batches WHERE project_id='$($project.id)' AND source_path='$source' AND status='done' AND deleted_at IS NULL LIMIT 1;"
    $done = & 'C:\Users\14226\AppData\Local\Programs\Podman\podman.exe' exec det-dashboard-postgres psql -U det -d det_dashboard -At -c $doneSql
    if ($done) { Write-Host "Skip completed $source"; continue }
    $payload = @{ projectId=$project.id; sourcePath=$source; sourcePaths=@($source); rename=$false; labelVersionName=('alashan_' + $sceneDir.Name + '_' + $modalityDir.Name) }
    try {
      $result = Invoke-RestMethod -Uri "$base/api/imports" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 5)
      Wait-Import $result.batch.id
    } catch {
      Write-Host "Import request failed for ${source}: $($_.ErrorDetails.Message)"
    }
  }
}
Write-Host 'Alashan import completed.'
