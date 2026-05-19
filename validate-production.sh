#!/bin/bash
# Pre-deployment validation script for Render

echo "🔍 Validando app para producción en Render..."
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASS=0
FAIL=0

# Check function
check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
    ((PASS++))
  else
    echo -e "${RED}✗${NC} $1"
    ((FAIL++))
  fi
}

# 1. Check Node version
echo "📋 Verificando requisitos..."
node --version > /dev/null
check "Node.js instalado"

npm --version > /dev/null
check "npm instalado"

# 2. Check dependencies
echo ""
echo "📦 Verificando dependencias..."
npm ls > /dev/null 2>&1
check "Dependencias instaladas"

# 3. Check TypeScript
echo ""
echo "📝 Verificando TypeScript..."
npm run lint > /dev/null 2>&1
check "Sin errores TypeScript"

# 4. Check build
echo ""
echo "🔨 Verificando build..."
npm run build > /dev/null 2>&1
check "Build exitoso"

# 5. Check environment files
echo ""
echo "🔐 Verificando archivos de configuración..."
[ -f ".env.example" ]
check "Archivo .env.example existe"

[ -f ".env.production" ]
check "Archivo .env.production existe"

[ -f "render.yaml" ]
check "Archivo render.yaml existe"

[ -f "server.ts" ]
check "Archivo server.ts existe"

# 6. Check for hardcoded values
echo ""
echo "🔒 Validando seguridad..."
! grep -r "hardcoded" src/ --include="*.ts" --include="*.tsx" > /dev/null 2>&1
check "Sin valores hardcodeados"

# 7. Check dist folder
echo ""
echo "📁 Verificando output..."
[ -d "dist" ]
check "Carpeta dist generada"

[ -f "dist/index.html" ]
check "index.html en dist"

[ -f "dist/server.cjs" ]
check "server.cjs en dist"

# Summary
echo ""
echo "================================"
if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}✓ Todas las validaciones pasaron${NC}"
  echo "🚀 La app está lista para deploy en Render"
  exit 0
else
  echo -e "${RED}✗ Algunas validaciones fallaron${NC}"
  echo "Por favor, revisa los errores arriba"
  exit 1
fi
