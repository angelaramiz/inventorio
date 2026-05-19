# Pre-Deploy Checklist - Inventario App para Render

## ✅ Checklist de Configuración

### Backend (server.ts)
- [x] Puerto usa variable de entorno `PORT`
- [x] `NODE_ENV` diferencia entre dev y production
- [x] CORS configurado adecuadamente
- [x] Headers de seguridad añadidos
- [x] Health check en `/api/health` implementado
- [x] Supabase usa lazy loading
- [x] Error handling en todas las rutas

### Frontend (React + Vite)
- [x] Build optimizado para producción
- [x] Code splitting configurado
- [x] Sourcemaps deshabilitados en producción
- [x] Static files cacheados correctamente

### Environment Variables
- [x] `.env.example` actualizado
- [x] `.env.production` creado
- [x] `render.yaml` configurado
- [x] No hay valores hardcodeados de env en el código

### Seguridad
- [x] CORS restricto a orígenes específicos
- [x] Content-Type, X-Frame-Options headers
- [x] Multer file size limitado (200KB)
- [x] JSON body size limitado (1MB)

### Performance
- [x] Vite minification en producción
- [x] Tree-shaking habilitado
- [x] Static files serve con Cache-Control

### Testing Recomendado

```bash
# 1. Test build localmente
npm run build
npm start

# 2. Verificar que no hay errores TypeScript
npm run lint

# 3. Probar rutas API
curl http://localhost:3000/api/health
curl http://localhost:3000/api/productos
```

## 🚀 Pasos Finales Antes de Deploy

1. **Verificar que el .git está limpio**
   ```bash
   git status
   ```

2. **Asegurar que todas las dependencias están instaladas**
   ```bash
   npm install
   ```

3. **Test de build**
   ```bash
   npm run build
   npm run lint
   ```

4. **Commit y push a main**
   ```bash
   git add .
   git commit -m "chore: prepare for production on Render"
   git push origin main
   ```

5. **Ir a Render y conectar el repositorio**
   - Ver `DEPLOY_RENDER.md` para instrucciones detalladas

## 📊 Monitoreo Post-Deploy

**Después del deploy, verifica:**

1. ✅ Health check responde: `https://[APP_NAME].onrender.com/api/health`
2. ✅ Frontend carga correctamente
3. ✅ APIs responden (productos, cajas)
4. ✅ Validar CORS si accedes desde otro dominio
5. ✅ Revisar logs en Render dashboard

## 🎯 Configuración Renderizada

Cuando hagas deploy, verifica que Render tenga:

```
NAME: inventario-app
RUNTIME: Node
BUILD: npm run build
START: npm start
HEALTH_CHECK: /api/health
ENV:
  - NODE_ENV=production
  - SUPABASE_URL=tu_url
  - SUPABASE_KEY=tu_key
  - ALLOWED_ORIGINS=https://inventario-app.onrender.com
  - PORT=3000
```

---

**Status:** ✅ Listo para producción
**Última actualización:** 2026-05-19
