$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$toolchain = 'E:\projects\aarch64\arm-gnu-toolchain'
$env:CROSS_ROOT = Join-Path $root 'cross-compile-env'
$env:TARGET_TRIPLE = 'aarch64-none-linux-gnu'
$env:CC = Join-Path $toolchain 'bin\aarch64-none-linux-gnu-gcc.exe'
$env:CXX = Join-Path $toolchain 'bin\aarch64-none-linux-gnu-g++.exe'
$env:AR = Join-Path $toolchain 'bin\aarch64-none-linux-gnu-ar.exe'
$env:STRIP = Join-Path $toolchain 'bin\aarch64-none-linux-gnu-strip.exe'
if (!(Test-Path $env:CC) -or !(Test-Path $env:CXX)) { throw "ARM64 toolchain not found: $toolchain" }
Write-Host "ARM64 cross compiler ready: $env:TARGET_TRIPLE"
Write-Host "CC=$env:CC"
Write-Host "CXX=$env:CXX"
