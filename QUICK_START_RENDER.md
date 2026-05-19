# ⚡ Quick Start - Deploy en Render (5 Minutos)

## 📋 Checklist Rápido

```bash
# 1. Validar que todo funciona
npm run build
npm run lint
npm start

# 2. Hacer push a GitHub
git add .
git commit -m "Production ready for Render"
git push origin main

# 3. Ir a render.com y:
#    - Conectar repo
#    - Añadir env vars (SUPABASE_URL, SUPABASE_KEY)
#    - Deploy

# 4. Verificar
curl https://[APP_NAME].onrender.com/api/health
```

## 🔧 Pasos Detallados

### Paso 1: Validación Local (2 min)
```bash
npm install          # Asegurar deps
npm run build        # Verificar build
npm run lint         # Verificar TypeScript
npm start            # Correr localmente (Ctrl+C para salir)
```

### Paso 2: Push a GitHub (1 min)
```bash
git status           # Ver cambios
git add .
git commit -m "chore: production ready for Render"
git push origin main # Push
```

### Paso 3: Deploy en Render (1 min)
1. Ir a https://render.com
2. Crear cuenta si no tienes
3. "New +" → "Web Service"
4. Seleccionar tu repo GitHub
5. Render verá `render.yaml` automáticamente
6. Click "Create Web Service"

### Paso 4: Variables de Entorno (1 min)
En el formulario de Render, llenar:
```
SUPABASE_URL=https://[tu-project].supabase.co
SUPABASE_KEY=[tu-clave-publica]
ALLOWED_ORIGINS=https://[app-name].onrender.com
```

### Paso 5: Verificar (Automático)
```bash
# Esperar 3-5 min a que termine el deploy
# Luego en terminal:
curl https://[app-name].onrender.com/api/health

# Respuesta = ✅ Funcionando
```

---

## 🎯 Variables de Entorno Requeridas

| Variable | Dónde obtener |
|----------|---------------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `SUPABASE_KEY` | Supabase Dashboard → Settings → API (public key) |

## 📊 Estado del Deploy

- 🟢 En progreso: Ves "Building" en Render
- 🟢 Completo: Ves "Running" en Render
- 🔴 Error: Revisa logs (Logs tab)

## 🐛 Troubleshooting Rápido

**Build falla:**
```bash
npm run build  # Verificar localmente
npm run lint   # Ver errores TypeScript
```

**App no inicia:**
```bash
# Verificar logs en Render Dashboard
# Revisar que env vars están configuradas
```

**API retorna 404:**
```bash
# Revisar que SUPABASE_URL y SUPABASE_KEY son correctas
curl https://[app].onrender.com/api/health
```

---

## 📱 Pruebar la App

Una vez desplegada, acceder a:
- **Frontend**: `https://[app-name].onrender.com`
- **API Health**: `https://[app-name].onrender.com/api/health`
- **API Productos**: `https://[app-name].onrender.com/api/productos`

---

## 🔄 Auto-Deploy

✅ Configurado automáticamente  
Cada push a `main` → Deploy automático  
No necesitas hacer nada más

---

## 📞 Ayuda Rápida

| Problema | Solución |
|----------|----------|
| Build lento | Render Free tarda más (5-10 min) |
| App inicia lento | Render suspende apps con inactividad |
| CORS error | Revisar `ALLOWED_ORIGINS` en env vars |
| No ve datos | Verificar credenciales Supabase |

---

**¿Listo?** Sigue los 5 pasos arriba y en 5-10 min estará en el aire 🚀
