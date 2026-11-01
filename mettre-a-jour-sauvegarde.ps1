$ErrorActionPreference = 'Stop'
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$siteFolder = 'C:\Users\youse\OneDrive\httpsjeu6boite.onrender.com'
$target = Join-Path $siteFolder 'etoiles-sauvegarde.json'
$archive = Join-Path $PSScriptRoot 'anciens-exports-etoiles'

try {
    $latest = Get-ChildItem $downloads -Filter 'gryphon-classement-etoiles-*.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw "Aucun fichier 'gryphon-classement-etoiles-*.json' dans $downloads. Clique d'abord sur 'Exporter le classement' sur le site." }

    $snapshot = Get-Content $latest.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($snapshot.format -ne 'gryphon-stars-leaderboard' -or $snapshot.version -ne 1 -or -not $snapshot.players) {
        throw "Le fichier $($latest.Name) n'est pas un export valide du classement."
    }
    $count = @($snapshot.players).Count
    $total = (@($snapshot.players) | ForEach-Object { [int]$_.balance } | Measure-Object -Sum).Sum

    if (Test-Path $target) {
        New-Item -ItemType Directory -Force $archive | Out-Null
        Copy-Item $target (Join-Path $archive ("etoiles-sauvegarde-" + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.json'))
    }
    Copy-Item $latest.FullName $target -Force

    Write-Host ''
    Write-Host "Fichier utilise : $($latest.Name) (export du $($latest.LastWriteTime))" -ForegroundColor Green
    Write-Host "$count joueurs, $total etoiles au total." -ForegroundColor Green
    Write-Host "Copie dans : $target" -ForegroundColor Green
    Write-Host ''
    Write-Host "Etape suivante : envoie le dossier du site sur Git (origin et jeu-gryphon), puis Manual Deploy sur Render."
} catch {
    Write-Host ''
    Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ''
Read-Host 'Appuie sur Entree pour fermer'
