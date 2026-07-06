# reset-extension-state.ps1 -- wipe every local trace of Adsum IoT Coder for a true first-install test.
#
# Run from a standalone PowerShell (close VS Code first -- it holds state files open and
# rewrites globalState on exit):
#
#   powershell -ExecutionPolicy Bypass -File scripts\reset-extension-state.ps1
#
# Options:
#   -BreakShellIntegration   also restore the fresh-Windows shell-integration bug state
#                            (execution policy Undefined + no default terminal profile)
#                            so the ShellIntegrationDoctor flow can be re-tested.
#   -IncludeDocuments        also delete ~\Documents\Cline (Rules/Workflows/MCP/Hooks).
#                            Off by default -- these can hold user-authored content.
#   -InstallVsix <path>      install a VSIX after cleaning.
#   -Marketplace             install the Marketplace version after cleaning.
#
# What gets removed:
#   * the extension itself (code --uninstall-extension)
#   * %USERPROFILE%\.vscode\extensions\adsumnetwork.nrf-ai-debugger-*
#   * %APPDATA%\Code\User\globalStorage\adsumnetwork.nrf-ai-debugger   (tasks, settings, install id)
#   * %APPDATA%\Code\User\workspaceStorage\*\adsumnetwork.nrf-ai-debugger
#   * adsum-iot-coder.* keys in user settings.json
#
# Note: key-value globalState/secrets in VS Code's shared state.vscdb are purged by VS Code
# itself on the first start after the uninstall -- start VS Code once before reinstalling if
# you need an absolutely pristine first run.

param(
	[switch]$BreakShellIntegration,
	[switch]$IncludeDocuments,
	[string]$InstallVsix,
	[switch]$Marketplace
)

$ErrorActionPreference = "Continue"
$extId = "adsumnetwork.nrf-ai-debugger"
$settingsPrefix = "adsum-iot-coder."

if (Get-Process -Name "Code" -ErrorAction SilentlyContinue) {
	Write-Warning "VS Code is running. State files may be locked or rewritten on exit -- close VS Code and re-run for a guaranteed-clean wipe. Continuing anyway..."
}

Write-Host "== Uninstalling $extId =="
code --uninstall-extension $extId 2>$null

Write-Host "== Removing extension folders =="
Get-ChildItem "$env:USERPROFILE\.vscode\extensions\$extId-*" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
	Write-Host "  removing $($_.FullName)"
	Remove-Item $_.FullName -Recurse -Force -Confirm:$false
}

Write-Host "== Removing globalStorage (tasks, settings cache, install id) =="
$gs = "$env:APPDATA\Code\User\globalStorage\$extId"
if (Test-Path $gs) {
	Write-Host "  removing $gs"
	Remove-Item $gs -Recurse -Force -Confirm:$false
}

Write-Host "== Removing workspaceStorage entries =="
Get-ChildItem "$env:APPDATA\Code\User\workspaceStorage" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
	$ws = Join-Path $_.FullName $extId
	if (Test-Path $ws) {
		Write-Host "  removing $ws"
		Remove-Item $ws -Recurse -Force -Confirm:$false
	}
}

if ($IncludeDocuments) {
	$docs = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Cline"
	if (Test-Path $docs) {
		Write-Host "== Removing $docs =="
		Remove-Item $docs -Recurse -Force -Confirm:$false
	}
}

Write-Host "== Cleaning $settingsPrefix* keys from user settings.json =="
$settingsPath = "$env:APPDATA\Code\User\settings.json"
if (Test-Path $settingsPath) {
	try {
		$json = Get-Content $settingsPath -Raw | ConvertFrom-Json
		$keys = @($json.PSObject.Properties.Name | Where-Object { $_ -like "$settingsPrefix*" })
		foreach ($k in $keys) {
			Write-Host "  removing setting $k"
			$json.PSObject.Properties.Remove($k)
		}
		if ($keys.Count -gt 0) {
			$json | ConvertTo-Json -Depth 32 | Out-File $settingsPath -Encoding utf8
		}
	} catch {
		Write-Warning "  settings.json could not be parsed (comments?) -- remove $settingsPrefix* keys manually."
	}
}

if ($BreakShellIntegration) {
	Write-Host "== Restoring fresh-Windows shell-integration bug state =="
	Set-ExecutionPolicy -ExecutionPolicy Undefined -Scope CurrentUser -Force
	try {
		$json = Get-Content $settingsPath -Raw | ConvertFrom-Json
		if ($json.PSObject.Properties.Name -contains "terminal.integrated.defaultProfile.windows") {
			$json.PSObject.Properties.Remove("terminal.integrated.defaultProfile.windows")
			$json | ConvertTo-Json -Depth 32 | Out-File $settingsPath -Encoding utf8
			Write-Host "  removed terminal.integrated.defaultProfile.windows"
		}
	} catch {
		Write-Warning "  settings.json could not be parsed -- remove terminal.integrated.defaultProfile.windows manually."
	}
	$env:PSExecutionPolicyPreference = $null
	$effective = & "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Get-ExecutionPolicy"
	Write-Host "  effective policy is now: $effective"
}

if ($InstallVsix) {
	Write-Host "== Installing VSIX: $InstallVsix =="
	code --install-extension $InstallVsix
} elseif ($Marketplace) {
	Write-Host "== Installing Marketplace version =="
	code --install-extension $extId
}

Write-Host ""
Write-Host "Done. Start VS Code -- first-run experience should be pristine."
