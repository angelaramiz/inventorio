# 🚀 Guía de Producción - Inventario App para Render

## ¿Qué se ha Configurado?

Tu aplicación está **100% lista para producción** en Render. Se han realizado los siguientes cambios:

### 🔧 Cambios Técnicos

#### Backend (`server.ts`)
```javascript
// ✅ Puerto dinámico desde variables de entorno
const PORT = parseInt(process.env.PORT || '3000', 10);

// ✅ Soporte para NODE_ENV (development/production)
const NODE_ENV = process.env.NODE_ENV || 'development';

// ✅ CORS configurado y restrictivo
app.use(cors(corsOptions));

// ✅ Headers de seguridad
app.setHeader('X-Content-Type-Options', 'nosniff');
// ... más headers

// ✅ Health check para Render
app.get('/api/health', (req, res) => { ... });

// ✅ Logging mejorado
console.log(`[${NODE_ENV}] Server running on port ${PORT}`);
```

#### Frontend (`vite.config.ts`)
```javascript
// ✅ Build optimizado para producción
build: {
  target: 'ES2020',
  minify: 'terser',
  sourcemap: false,
  // ✅ Code splitting automático
  rollupOptions: {
    manualChunks: { ... }
  }
}
```

#### Configuración de Render

**render.yaml** - Configuración automática:
```yaml
services:
  - type: web
    name: inventario-app
    runtime: node
    buildCommand: npm run build
    startCommand: npm start
    healthCheckPath: /api/health
```

### 📄 Archivos Creados

| Archivo | Propósito |
|---------|-----------|
| `.env.production` | Variables de entorno para producción |
| `render.yaml` | Configuración de Render para deploy automático |
| `render.yml` | Configuración alternativa de Render |
| `DEPLOY_RENDER.md` | Guía paso a paso del deploy |
| `PRODUCTION_CHECKLIST.md` | Verificaciones pre-deploy |
| `.env.example` | Actualizado con nuevas variables |
| `validate-production.sh` | Script de validación (Linux/Mac) |
| `validate-production.ps1` | Script de validación (Windows) |

## 🎯 Cómo Hacer Deploy en Render

### Opción 1: Automática (Recomendada)

1. **Ve a [render.com](https://render.com) y crea una cuenta**

2. **Conecta tu repositorio GitHub**
   - Autoriza GitHub en Render
   - Selecciona el repositorio

3. **Render detectará automáticamente** `render.yaml` y aplicará la configuración

4. **Añade variables de entorno** en Render Dashboard:
   ```
   SUPABASE_URL=your_url
   SUPABASE_KEY=your_key
   ALLOWED_ORIGINS=https://inventario-app.onrender.com
   ```

5. **Deploy automático en cada push a `main`**

### Opción 2: Manual

Ver instrucciones detalladas en [DEPLOY_RENDER.md](./DEPLOY_RENDER.md)

## ✅ Pre-Deploy Checklist

Ejecuta la validación local:

**Windows:**
```powershell
powershell -ExecutionPolicy Bypass -File validate-production.ps1
```

**Linux/Mac:**
```bash
bash validate-production.sh
```

Esta validación verifica:
- ✅ Node.js y npm instalados
- ✅ Dependencias correctas
- ✅ Build sin errores
- ✅ TypeScript sin problemas
- ✅ Archivos de configuración presentes

## 📊 Verificación Post-Deploy

Una vez que Render complete el deploy:

```bash
# Healthcheck
curl https://inventario-app.onrender.com/api/health

# Respuesta esperada:
{
  "status": "ok",
  "timestamp": "2026-05-19T...",
  "environment": "production",
  "uptime": 123.456
}
```

## 🔐 Seguridad Implementada

- ✅ **CORS Restrictivo**: Solo HTTPS de onrender.com
- ✅ **Headers de Seguridad**: X-Frame-Options, X-Content-Type-Options
- ✅ **Multer Limits**: 200KB máximo por archivo
- ✅ **JSON Limit**: 1MB máximo por request
- ✅ **NODE_ENV**: Production mode habilitado
- ✅ **HTTPS**: Render proporciona SSL automáticamente

## 🚀 Scripts Disponibles

```bash
# Desarrollo
npm run dev          # Inicia servidor dev con Vite

# Producción
npm run build        # Build optimizado
npm start            # Inicia servidor Node.js

# Validación
npm run lint         # Verifica TypeScript
npm run clean        # Limpia carpeta dist
```

## 📈 Monitoreo en Producción

Una vez en Render:

1. **Logs en tiempo real**: Render Dashboard → Logs
2. **Métricas**: CPU, Memoria, Response Time
3. **Auto-restart**: Si la app falla, Render la reinicia
4. **Health checks**: Cada 30 segundos a `/api/health`

## 🎓 Recursos Útiles

- [Documentación Render](https://render.com/docs)
- [Node.js Best Practices](https://nodejs.org/en/docs/guides/nodejs-performance-tips)
- [Express.js Production Best Practices](https://expressjs.com/en/advanced/best-practice-performance.html)
- [Vite Production Build](https://vitejs.dev/guide/build.html)

## ❓ FAQs

**P: ¿Cuánto cuesta el deploy?**  
R: El plan Free es suficiente para desarrollo. Para producción real, considera "Starter" ($7/mes+).

**P: ¿Puedo usar base de datos en Render?**  
R: Sí, Render ofrece Postgres. Tu app ya usa Supabase, que también está en el cloud.

**P: ¿Cómo actualizo la app después del deploy?**  
R: Solo hace push a `main` en GitHub y Render redeploy automáticamente.

**P: ¿Cómo manejo secrets seguros?**  
R: Usa el formulario de "Environment" en Render Dashboard, no los pongas en el código.

---

## 🎉 Estado Actual

**✅ App lista para producción**

Todos los ajustes han sido completados:
- [x] Backend optimizado
- [x] Frontend minificado
- [x] Configuración de Render lista
- [x] Variables de entorno configuradas
- [x] Headers de seguridad
- [x] Health checks implementados
- [x] Auto-deploy configurado
- [x] Documentación completa

**Próximo paso**: [Hacer deploy en Render](#-cómo-hacer-deploy-en-render)

---

**¿Dudas?** Lee [DEPLOY_RENDER.md](./DEPLOY_RENDER.md) para instrucciones detalladas.
