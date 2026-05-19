# Pre-deployment validation script for Render (Windows)
# Run: powershell -ExecutionPolicy Bypass -File validate-production.ps1

Write-Host "🔍 Validando app para producción en Render..." -ForegroundColor Cyan
Write-Host ""

$pass = 0
$fail = 0

function Check-Condition {
    param([string]$description, [scriptblock]$condition)
    
    if (& $condition) {
        Write-Host "✓ $description" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "✗ $description" -ForegroundColor Red
        $script:fail++
    }
}

# 1. Check Node version
Write-Host "📋 Verificando requisitos..." -ForegroundColor Yellow
Check-Condition "Node.js instalado" { node --version }
Check-Condition "npm instalado" { npm --version }

# 2. Check dependencies
Write-Host ""
Write-Host "📦 Verificando dependencias..." -ForegroundColor Yellow
Check-Condition "node_modules existe" { Test-Path "node_modules" }

# 3. Check TypeScript
Write-Host ""
Write-Host "📝 Verificando TypeScript..." -ForegroundColor Yellow
$lintOutput = npm run lint 2>&1
Check-Condition "Sin errores TypeScript" { $LASTEXITCODE -eq 0 }

# 4. Check build
Write-Host ""
Write-Host "🔨 Verificando build..." -ForegroundColor Yellow
$buildOutput = npm run build 2>&1
Check-Condition "Build exitoso" { $LASTEXITCODE -eq 0 }

# 5. Check environment files
Write-Host ""
Write-Host "🔐 Verificando archivos de configuración..." -ForegroundColor Yellow
Check-Condition "Archivo .env.example existe" { Test-Path ".env.example" }
Check-Condition "Archivo .env.production existe" { Test-Path ".env.production" }
Check-Condition "Archivo render.yaml existe" { Test-Path "render.yaml" }
Check-Condition "Archivo server.ts existe" { Test-Path "server.ts" }

# 6. Check dist folder
Write-Host ""
Write-Host "📁 Verificando output..." -ForegroundColor Yellow
Check-Condition "Carpeta dist existe" { Test-Path "dist" }
Check-Condition "index.html en dist" { Test-Path "dist/index.html" }
Check-Condition "server.cjs en dist" { Test-Path "dist/server.cjs" }

# Summary
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan

if ($fail -eq 0) {
    Write-Host "✓ Todas las validaciones pasaron" -ForegroundColor Green
    Write-Host "🚀 La app está lista para deploy en Render" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "✗ Algunas validaciones fallaron ($fail)" -ForegroundColor Red
    Write-Host "Por favor, revisa los errores arriba" -ForegroundColor Yellow
    exit 1
}
