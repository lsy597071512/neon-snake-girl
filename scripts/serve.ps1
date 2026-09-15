param(
  [int]$Port = 8080,
  [string]$Root = "."
)

$Root = (Resolve-Path $Root).Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "Serving $Root on http://localhost:$Port/"

Start-Sleep -Milliseconds 500
Start-Process "http://127.0.0.1:$Port/"

function Get-ContentType($path) {
  switch -Regex ($path) {
    '\.html$' { return 'text/html; charset=utf-8' }
    '\.js$'   { return 'application/javascript; charset=utf-8' }
    '\.css$'  { return 'text/css; charset=utf-8' }
    '\.svg$'  { return 'image/svg+xml' }
    '\.png$'  { return 'image/png' }
    '\.json$' { return 'application/json' }
    default   { return 'application/octet-stream' }
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $rel = [Uri]::UnescapeDataString($request.Url.LocalPath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }

    $file = Join-Path $Root ($rel -replace '/', '\')
    if (-not (Test-Path $file -PathType Leaf)) {
      $file = Join-Path $Root 'index.html'
    }

    $bytes = [System.IO.File]::ReadAllBytes($file)
    $response.ContentType = Get-ContentType $file
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.Close()
  }
} finally {
  $listener.Stop()
}
