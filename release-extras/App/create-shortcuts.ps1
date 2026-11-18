# Creates the Prospect Finder desktop shortcut for whichever folder this app lives in.
$ErrorActionPreference = 'Stop'
$appDir = $PSScriptRoot
$exe = Join-Path $appDir 'Prospect Finder.exe'
if (-not (Test-Path $exe)) { throw "Prospect Finder.exe not found in $appDir" }

# Files copied from another PC or a downloaded zip can be flagged by Windows; clear that so the app opens normally.
Get-ChildItem -Path $appDir -Recurse -File | Unblock-File

$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$main = $shell.CreateShortcut((Join-Path $desktop 'Prospect Finder.lnk'))
$main.TargetPath = $exe
$main.WorkingDirectory = $appDir
$main.IconLocation = "$exe,0"
$main.Description = 'Open Prospect Finder'
$main.Save()

Write-Host ''
Write-Host ' Done! A "Prospect Finder" icon was added to your desktop.'
Write-Host ''



