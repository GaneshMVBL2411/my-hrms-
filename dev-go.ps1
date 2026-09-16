# Starts the phone app in Expo Go, with the QR code in this window.
#
#   npm run go
#
# The difference from `npm run dev` is which Metro is running. `dev` starts
# Metro for a development build — the app installed from EAS, with the native
# modules compiled in. Expo Go cannot load that bundle. Running both at once
# is worse than running neither: the second Metro takes port 8082 and the
# phone attaches to whichever it was last pointed at, so the app silently
# serves code from the wrong one.
#
# So this stops any Metro first and starts exactly one, in Expo Go mode, in
# the foreground — the QR has to be somewhere you can see it. The API and the
# web portal are left running, or started if they are not, because the app is
# a client and has nothing to talk to without them.
#
# Ctrl+C stops Metro and leaves the other two up. .\dev-down.ps1 stops all.

param([switch] $Hidden)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Test-Port([int] $port) {
  return [bool] (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "Expo Go" -ForegroundColor Cyan

# 8082 as well as 8081: that is where a second Metro lands, and a stray one
# there outlives the window it was started from more often than not.
foreach ($port in 8081, 8082) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { continue }
  foreach ($owner in ($conns.OwningProcess | Select-Object -Unique)) {
    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
  }
  Write-Host ("  stopped the Metro on {0}" -f $port) -ForegroundColor Yellow
}

# Windows does not free a listening port the instant the process dies, and
# Expo responds to a port still in TIME_WAIT by quietly moving to 8082 —
# which is the thing this script exists to prevent.
$waited = 0
while ((Test-Port 8081) -and $waited -lt 20) {
  Start-Sleep -Milliseconds 250
  $waited++
}

# A hashtable, not an array. Splatting an array passes its elements
# positionally, so "-NoMetro" arrives as a value rather than as the switch —
# dev-up.ps1 then starts the development-build Metro on 8081 and expo finds
# the port taken, which is the one thing this script is here to prevent.
$upArgs = @{ NoMetro = $true }
if ($Hidden) { $upArgs["Hidden"] = $true }
& (Join-Path $root "dev-up.ps1") @upArgs

Write-Host ""
Write-Host "Scan the QR below with Expo Go. The app finds the API from it." -ForegroundColor Cyan
Write-Host "Ctrl+C stops Metro; the API and web portal keep running." -ForegroundColor DarkGray
Write-Host ""

Set-Location -LiteralPath (Join-Path $root "mobile")
# The port is named rather than left to expo. With it free this changes
# nothing; with it somehow taken, expo stops and says so instead of quietly
# moving to 8082 and serving a phone that is pointed at 8081.
npx expo start --go --port 8081
