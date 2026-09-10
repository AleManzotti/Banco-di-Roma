$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

function Test-ServerUp {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-ServerUp) {
    Start-Process "http://localhost:5173/"
    exit
}

Start-Process cmd -ArgumentList "/k", "npm run dev" -WorkingDirectory $projectDir

$maxRetries = 30
$i = 0
while (-not (Test-ServerUp) -and $i -lt $maxRetries) {
    Start-Sleep -Seconds 1
    $i++
}

if (Test-ServerUp) {
    Start-Process "http://localhost:5173/"
} else {
    Write-Host "O servidor demorou demais para responder. Confira a janela do terminal para ver se apareceu algum erro."
    Read-Host "Pressione Enter para fechar"
}
