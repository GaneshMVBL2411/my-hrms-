# Starts the three development servers.
#
# One command, three servers: the API on 3001, the web portal (and its /api
# proxy) on 5173, and Metro for the phone on 8081. They are not children of
# whatever launched this script, so they outlive it. That is the reason this
# file exists: servers started from inside an assistant session died every
# time that session ended, and every one of those deaths reached the phone as
# "Failed to connect" with nothing else to go on.
#
# Two ways to run it, for two situations:
#
#   .\dev-up.ps1          Each server in its own PowerShell window, logs live,
#                         Ctrl+C or close the window to stop one. For a person
#                         at the keyboard.
#
#   .\dev-up.ps1 -Hidden  No windows. Each server runs in the background and
#                         writes to .dev-logs\<name>.log. For anything without
#                         a desktop — an assistant, a scheduled task, a remote
#                         shell — where a windowed PowerShell exits at once
#                         because there is no console for it to attach to.
#                         Found the hard way: six windows opened and none ran.
#
# A port that is already in use is left alone rather than fought over. A
# second Metro on 8082 is worse than none — the phone attaches to whichever
# it was last pointed at, and the two can be serving different code.

param(
  [switch] $Hidden,
  # For dev-go.ps1, which starts Metro itself, in Expo Go mode, in the window
  # you are reading. Without this it would find 8081 taken and leave it alone.
  [switch] $NoMetro
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logDir = Join-Path $root ".dev-logs"

function Test-Port([int] $port) {
  return [bool] (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Server([string] $title, [string] $dir, [string] $command, [int] $port) {
  if (Test-Port $port) {
    Write-Host ("  {0,-8} already on {1} - left as is" -f $title, $port) -ForegroundColor DarkGray
    return
  }

  if ($Hidden) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $log = Join-Path $logDir "$($title.ToLower()).log"
    # Overwritten per start, and stdout and stderr both land in it: a crash is
    # the thing most worth having in the file, and it arrives on stderr.
    $inner = "Set-Location -LiteralPath '$dir'; & { $command } *>> '$log'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
    Remove-Item $log -ErrorAction SilentlyContinue
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded -WindowStyle Hidden | Out-Null
    Write-Host ("  {0,-8} starting on {1}  -> {2}" -f $title, $port, $log) -ForegroundColor Green
    return
  }

  # The window title is set from inside the new session so it shows in the
  # taskbar; -NoExit keeps the window open after the server exits, which is
  # how a crash stays readable instead of vanishing.
  #
  # Passed base64-encoded rather than as -Command text: Start-Process joins
  # its argument list back into one string and the new shell re-parses it,
  # and a command containing quotes and spaces does not survive that round
  # trip. -EncodedCommand is the documented way to hand a shell a script
  # verbatim.
  $inner = "`$host.UI.RawUI.WindowTitle = 'HRMS $title'; Set-Location -LiteralPath '$dir'; $command"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded | Out-Null
  Write-Host ("  {0,-8} starting on {1}" -f $title, $port) -ForegroundColor Green
}

Write-Host ("HRMS dev servers" + $(if ($Hidden) { " (hidden, logging to .dev-logs\)" } else { "" })) -ForegroundColor Cyan
Start-Server "API"    (Join-Path $root "server")   "npm run dev"     3001
Start-Server "Web"    (Join-Path $root "frontend") "npx vite --host" 5173
if (-not $NoMetro) {
  Start-Server "Metro"  (Join-Path $root "mobile")   "npm run dev"     8081
}

# The address the phone will use, so it is in front of you without asking.
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "Web portal:  http://localhost:5173" -ForegroundColor Cyan
if ($ip) { Write-Host "From phone:  exp://${ip}:8081   (API follows Metro automatically)" -ForegroundColor Cyan }
Write-Host "Stop all:    .\dev-down.ps1" -ForegroundColor DarkGray
