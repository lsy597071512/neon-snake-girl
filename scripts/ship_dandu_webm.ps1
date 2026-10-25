$map = @{
  '01' = 'SR01_2'; '02' = 'SR01_3'; '03' = 'SR02_1'; '04' = 'SR03_1';
  '05' = 'SR04_1'; '06' = 'SR05_1'; '07' = 'SSR01_1'; '08' = 'SSR02_1';
  '09' = 'SSR03_1'; '10' = 'SSR04_1'; '11' = 'SSR05_1'; '12' = 'UR03_1'; '13' = 'UR04_1'
}
$srcDir = 'tex/juese/pifu/dandu/new/_webm_out'
$dstDir = 'tex/juese/pifu/dandu'
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
$files = Get-ChildItem "$srcDir/*_src.webm"
$groups = $files | ForEach-Object {
  $m = [regex]::Match($_.BaseName, '^(\d\d)\d')
  if ($m.Success) { [pscustomobject]@{ Group = $m.Groups[1].Value; File = $_ } }
} | Group-Object Group | Sort-Object Name
foreach ($g in $groups) {
  $stem = $map[$g.Name]
  if (-not $stem) { Write-Output ('SKIP unknown group ' + $g.Name); continue }
  $i = 0
  foreach ($item in ($g.Group | Sort-Object { $_.File.Name })) {
    if ($i -eq 0) { $dst = "$dstDir/" + $stem + '_dandu.webm' }
    else { $dst = "$dstDir/" + $stem + '_dandu_' + $i + '.webm' }
    Copy-Item $item.File.FullName $dst -Force
    Write-Output ($item.File.Name + ' -> ' + (Split-Path $dst -Leaf))
    $i++
  }
}
Write-Output 'DONE'
