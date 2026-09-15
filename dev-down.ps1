# Stops whatever is listening on the three development ports.
#
# By port rather than by window, because the thing holding a port is not
# always the window that was opened for it: Metro in particular has been left
# behind as an orphaned node process more than once, still bound to 8081 and
# still serving a bundle from before a package was installed. Finding the
# listener and ending it is the only version of "stop" that is reliable.

$ports = @(
  @{ Name = "API";   Port = 3001 },
  @{ Name = "Web";   Port = 5173 },
  @{ Name = "Metro"; Port = 8081 },
  # Where Expo goes when 8081 is taken. Cleared too, so the next start does
  # not inherit a stray second server.
  @{ Name = "Metro (alt)"; Port = 8082 }
)

foreach ($p in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $p.Port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host ("  {0,-12} nothing on {1}" -f $p.Name, $p.Port) -ForegroundColor DarkGray
    continue
  }
  foreach ($pid_ in ($conns.OwningProcess | Select-Object -Unique)) {
    Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
  }
  Write-Host ("  {0,-12} stopped on {1}" -f $p.Name, $p.Port) -ForegroundColor Yellow
}
