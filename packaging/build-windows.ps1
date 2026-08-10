# ==============================================================================
# RGBA Channel Packer - Windows Desktop Packaging Script (Electron + Bun)
# Generates Windows .exe (NSIS Setup) & Portable .exe installers
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting RGBA Channel Packer Windows Build Pipeline (Electron + Bun)..." -ForegroundColor Cyan

# 1. Verify Bun Installation
Write-Host "🍞 Checking Bun runtime..." -ForegroundColor Yellow
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun is not installed. Installing Bun via PowerShell..." -ForegroundColor Yellow
    powershell -c "irm bun.sh/install.ps1 | iex"
    $env:Path += ";$env:USERPROFILE\.bun\bin"
} else {
    $bunVer = bun --version
    Write-Host "✓ Bun found: v$bunVer" -ForegroundColor Green
}

# 2. Locate Project Root Directory
$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath
$projectRoot = Split-Path -Parent $scriptDir

Set-Location -Path $projectRoot
Write-Host "📂 Working directory: $projectRoot" -ForegroundColor Gray

# 3. Install Bun Dependencies
Write-Host "📥 Installing Electron dependencies with Bun..." -ForegroundColor Yellow
bun install

# 4. Build Windows Standalone Application
Write-Host "🛠️ Building Windows Desktop Standalone Application (NSIS EXE & Portable)..." -ForegroundColor Cyan
bun run build:win

Write-Host "==============================================================================" -ForegroundColor Green
Write-Host "🎉 Windows Desktop Build Completed Successfully!" -ForegroundColor Green
Write-Host "Build outputs are located at:" -ForegroundColor White
Write-Host "  • Setup Installer (.exe):    $projectRoot\dist\RGBA Channel Packer Setup 1.0.0.exe" -ForegroundColor Cyan
Write-Host "  • Portable Binary (.exe):    $projectRoot\dist\RGBA Channel Packer 1.0.0.exe" -ForegroundColor Cyan
Write-Host "==============================================================================" -ForegroundColor Green
