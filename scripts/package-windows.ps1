$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = (& $nodePath -p 'process.version').Trim()
$nodeArch = (& $nodePath -p 'process.arch').Trim()
if ($nodeArch -ne 'x64') { throw 'This package script requires x64 Node.js on Windows.' }
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$distRoot = Join-Path $projectRoot 'dist'
$packageName = "TokenTempo-$version-windows-x64"
$stage = Join-Path $distRoot ($packageName + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $stage,(Join-Path $stage 'runtime') -Force | Out-Null
foreach ($name in @('src','README.md','LICENSE','package.json','Start-TokenTempo.cmd')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage -Recurse
}
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $stage 'runtime\node.exe')
$licenseUrl = "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE"
Invoke-WebRequest -Uri $licenseUrl -OutFile (Join-Path $stage 'runtime\NODE-LICENSE.txt')
if ((Get-Item -LiteralPath (Join-Path $stage 'runtime\NODE-LICENSE.txt')).Length -lt 1000) { throw 'Node license download is incomplete.' }
"Bundled Node.js: $nodeVersion ($nodeArch). License: runtime/NODE-LICENSE.txt" | Set-Content -LiteralPath (Join-Path $stage 'RUNTIME.txt') -Encoding utf8
$zip = Join-Path $distRoot "$packageName.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $packageName.zip" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
Write-Output $zip
Write-Output "$zip.sha256"
