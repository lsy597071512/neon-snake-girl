#!/usr/bin/env pwsh
# Delete the malformed rustbelt-:latest models
# Usage: pwsh scripts/cleanup_malformed_models.ps1

Write-Host "Cleaning malformed models..." -ForegroundColor Yellow
$models = & ollama list 2>&1

foreach ($line in $models) {
    if ($line -match '^rustbelt-[^\s]+:latest' -and $line -match '^rustbelt-:[^a-z]') {
        $name = ($line -split '\s+')[0]
        Write-Host "Removing: $name" -ForegroundColor Red
        & ollama rm $name
    }
}

Write-Host ""
Write-Host "Current models:" -ForegroundColor Green
& ollama list
