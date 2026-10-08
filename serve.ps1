# NEXUS JEE — test-only static file server (PowerShell, no dependencies).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 [-Port 8461]
# Serves this folder at http://127.0.0.1:<port>/ — safe to delete after testing.
param([int]$Port = 8461)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)) + [System.IO.Path]::DirectorySeparatorChar
$port = $Port
$types = @{'.html'='text/html; charset=utf-8'; '.htm'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.ico'='image/x-icon'}
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
$listener.Start()
Write-Host "Serving $root at http://127.0.0.1:$port/"
while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $reqLine = $reader.ReadLine()
    while ($true) { $l = $reader.ReadLine(); if ([string]::IsNullOrEmpty($l)) { break } }
    if (-not $reqLine) { throw 'empty request' }
    $parts = $reqLine -split ' '
    $path = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0])
    if ($path -eq '/') { $path = '/index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart('/') -replace '/', '\')))
    $bytes = $null; $mime = 'application/octet-stream'; $code = '404 Not Found'
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      if ($types.ContainsKey($ext)) { $mime = $types[$ext] }
      $code = '200 OK'
    } else { $bytes = [System.Text.Encoding]::ASCII.GetBytes('404 Not Found'); $mime = 'text/plain' }
    $hdr = "HTTP/1.1 $code`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($hdr)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch { Write-Host $_.Exception.Message }
  finally { $client.Close() }
}
