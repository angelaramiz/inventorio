# Deploy a Render - Guía de Producción

## 📋 Prerequisitos

- Cuenta en [Render.com](https://render.com)
- Repositorio GitHub con el código
- Variables de entorno (SUPABASE_URL, SUPABASE_KEY)

## 🚀 Pasos para Deploy

### 1. Conectar Repositorio a Render

1. Inicia sesión en [Render Dashboard](https://dashboard.render.com)
2. Haz clic en **"New+"** → **"Web Service"**
3. Selecciona tu repositorio GitHub
4. Configura los siguientes valores:

| Campo | Valor |
|-------|-------|
| **Name** | `inventario-app` |
| **Runtime** | Node |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free (o la que prefieras) |
| **Region** | Ohio (o cercano a tus usuarios) |

### 2. Configurar Variables de Entorno

En la sección **"Environment"** del formulario, añade:

```
NODE_ENV=production
PORT=3000
SUPABASE_URL=<tu_supabase_url>
SUPABASE_KEY=<tu_supabase_key>
ALLOWED_ORIGINS=https://inventario-app.onrender.com
```

**⚠️ Reemplaza**:
- `tu_supabase_url` → Tu URL de Supabase
- `tu_supabase_key` → Tu clave pública de Supabase
- `inventario-app` → El nombre que le diste a tu servicio

### 3. Deploy Inicial

1. Haz clic en **"Create Web Service"**
2. Render comenzará el build automáticamente
3. Monitorea los logs en tiempo real
4. Cuando veas "Server running on port 3000" → ✅ Está listo

### 4. Verificar el Funcionamiento

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

## 🔄 Auto-Deploy

- Cada push a `main` desplegará automáticamente
- Los cambios se actualizarán sin necesidad de intervención manual

## 📊 Monitorear en Producción

### Logs en Tiempo Real
```
Dashboard → Logs → Ver últimas líneas
```

### Métricas
- CPU y memoria en Dashboard
- Response times y errores

### Health Check Automático
Render verifica `/api/health` cada 30 segundos

## 🛠️ Troubleshooting

### Error: "Build failed"
```bash
# Verifica que package.json tiene todas las dependencias
npm install
npm run build
```

### Error: "SUPABASE_URL is missing"
→ Asegúrate de que las variables están en Render Dashboard

### Error: "Port 3000 is in use"
→ Render maneja automáticamente; revisa si hay múltiples instancias

### Sitio muy lento
→ Upgrade a plan "Starter" o superior

## 🔐 Seguridad en Producción

✅ Headers de seguridad implementados
✅ CORS configurado
✅ Variables sensibles en Render (no en código)
✅ NODE_ENV=production habilitado

## 📝 Notas Importantes

- El plan Free de Render inicia el servicio lentamente después de inactividad
- Para producción real, considera plan "Starter" o superior
- Las credenciales de Supabase deben ser válidas
- Render proporciona un dominio `.onrender.com` automáticamente

## 🎯 Próximos Pasos

1. ✅ Deploy inicial exitoso
2. 📱 Prueba la aplicación en tu teléfono
3. 🔄 Configura deployments automáticos desde GitHub
4. 📊 Monitorea logs y performance
5. 🚀 Migra a plan pagado si crece el uso

---

**¿Problemas?** Revisa los logs en Render Dashboard → "Logs"
