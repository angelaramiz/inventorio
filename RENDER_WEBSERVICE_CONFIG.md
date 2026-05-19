# 📋 Datos para Render Web Service

Copia estos datos exactamente para configurar tu servicio en Render.

---

## 🔧 Configuración Básica

| Campo | Valor |
|-------|-------|
| **Name** | `inventario-app` |
| **GitHub Repo** | `https://github.com/angelaramiz/inventorio` |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free (o Starter si quieres mejor performance) |
| **Region** | `Ohio` (o tu región más cercana) |

---

## 🔐 Variables de Entorno

**Copia cada línea en Render Dashboard → Environment:**

```
NODE_ENV
production

SUPABASE_URL
https://vflelimdbevxdmzekpia.supabase.co

SUPABASE_KEY
sb_publishable_1tYGgm--kBH_3aHHuzDtdQ_1oVi0Mxl

ALLOWED_ORIGINS
https://inventario-app.onrender.com

PORT
3000
```

⚠️ **Importante:**
- Reemplaza `inventario-app` con el nombre que le des a tu servicio
- Si cambias el nombre, también cambia `ALLOWED_ORIGINS`

---

## 📊 Health Check

| Campo | Valor |
|--------|-------|
| **Path** | `/api/health` |
| **Protocol** | HTTPS |

---

## 🚀 Paso a Paso en Render

1. **Ir a Dashboard → New → Web Service**

2. **Conectar Repositorio**
   - Autorizar GitHub si no está hecho
   - Seleccionar: `angelaramiz/inventorio`
   - Branch: `main`

3. **Configuración (dejará estos valores por defecto de render.yaml):**
   - Name: `inventario-app`
   - Runtime: `Node`
   - Build: `npm run build`
   - Start: `npm start`

4. **Añadir Variables de Entorno** (en el formulario):
   ```
   NODE_ENV = production
   SUPABASE_URL = https://vflelimdbevxdmzekpia.supabase.co
   SUPABASE_KEY = sb_publishable_1tYGgm--kBH_3aHHuzDtdQ_1oVi0Mxl
   ALLOWED_ORIGINS = https://inventario-app.onrender.com
   PORT = 3000
   ```

5. **Health Check (opcional pero recomendado):**
   - Path: `/api/health`

6. **Click "Create Web Service"**

7. **Esperar 5-10 minutos** a que complete

---

## ✅ Verificación Post-Deploy

Una vez que termine (estará "Running"):

```bash
# En terminal (después de 5-10 min)
curl https://inventario-app.onrender.com/api/health

# Respuesta esperada:
{
  "status": "ok",
  "timestamp": "2026-05-19T...",
  "environment": "production",
  "uptime": 123.456
}
```

---

## 📱 URLs de tu App

Una vez desplegada:

| Recurso | URL |
|---------|-----|
| **Frontend** | https://inventario-app.onrender.com |
| **API Health** | https://inventario-app.onrender.com/api/health |
| **API Productos** | https://inventario-app.onrender.com/api/productos |
| **API Cajas** | https://inventario-app.onrender.com/api/cajas |

---

## 🔄 Auto-Deploy Configurado

✅ Cada push a `main` → Deploy automático  
✅ render.yaml auto-detectado  
✅ No necesitas hacer nada más

---

## 🎯 Resumen Rápido

```
Repo: github.com/angelaramiz/inventorio
Branch: main
Build: npm run build
Start: npm start
Env Vars: NODE_ENV, SUPABASE_URL, SUPABASE_KEY, ALLOWED_ORIGINS, PORT
Health: /api/health
```

---

## ❓ Si Cambias de Nombre

Si usas un nombre diferente a `inventario-app`, cambia también:
- `ALLOWED_ORIGINS` → `https://[tu-nombre].onrender.com`

---

**¡Listo! Copia estos datos a Render y en 5-10 min estará en vivo 🚀**
