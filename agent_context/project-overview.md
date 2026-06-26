# Project Overview

`inventorio` es un sistema de gestión de inventario de almacén con frontend React + Vite y backend Express. Usa Supabase como base de datos y almacena imágenes de productos como datos binarios en Postgres.

**Versión actual**: `0.0.0` (en activo desarrollo — Alpha)  
**Última actualización significativa**: Junio 2026

---

## Flujos principales de usuario

- **Escaneo de productos**: Escaneo continuo por cámara (EAN/SKU) con registros rápidos en modal. Al detectar un código, el escáner se detiene automáticamente hasta guardar o cancelar.
- **Registro de productos**: Formulario rápido vía modal con captura de foto y campos de tipo, marca, talla, temporada, etc.
- **Inventario / Stock**: Lista de productos con filtros avanzados, edición individual, y edición grupal por `modelo_grupo` (express + avanzada en tabla editable).
- **Contenedores (Cajas)**: Vista renombrada de "Cajas" → **"Contenedores"**. CRUD completo de contenedores, asignación de niveles, transferencias individuales y masivas.
- **Modal de Detalles del Contenedor**: Muestra productos dentro, permite editar etiquetas (`tipo_producto`, `tipo_producto_exacto`, `genero`, `temporada`), y hacer transferencia total de todos los productos a otro destino jerárquico.
- **Almacén**: Gestión de zonas, pasillos, secciones y niveles. Selector jerárquico paso a paso para asignar destinos.
- **Consulta Dashboard**: Búsqueda de cajas/productos con historial en IndexedDB.
- **POS** (`/pos`): Terminal de punto de venta para vendedores.
- **Control de Inventario** (`/conteo_inv`, `/admin`): Conteo físico por operario + aprobaciones por gerente.

---

## Stack tecnológico

- **Frontend**: React 19, Vite 6, TypeScript 5.8, Tailwind CSS 4 (`@tailwindcss/vite`), ShadCN UI, `@base-ui/react`, `lucide-react`, `motion` (Framer Motion).
- **Backend**: Express 4, Supabase JS, `multer`, `cors`, `dotenv`.
- **Database**: Supabase / PostgreSQL con vistas personalizadas, jerarquía de 5 niveles y triggers.
- **Scanner**: `html5-qrcode` (usado en `ScannerView`, `POSView`, `ProductGroupEditModal`).
- **Animaciones**: `motion/react` (AnimatePresence para transiciones de tabs).
- **Build**: `npm run dev` → `tsx server.ts`, `npm run build` → Vite + esbuild, `npm start` → production.

---

## Rutas de la aplicación

| Ruta | Vista | Descripción |
|---|---|---|
| `/` | App (tabs) | Shell principal con navegación por tabs |
| `/dashboard` | ConsultaDashboard | Dashboard de consultas y búsquedas |
| `/pos` | POSView | Terminal POS de vendedor |
| `/conteo_inv` | InventoryControlView | Operario — conteo físico |
| `/admin` | InventoryControlView | Gerente — aprobaciones de conteo |

---

## Tabs de la app principal

1. **Dashboard** — `AlphaDashboardView` (métricas rápidas)
2. **Escanear** — `ScannerView` (escáner cámara + búsqueda manual)
3. **Productos** — `InventoryView` (lista, filtros, edición, edición grupal)
4. **Contenedores** — `CajasView` (antes "Cajas")
5. **Conceptos** — `ConceptosView` (temporadas, tipos, marcas)
6. **Almacén** — `AlmacenView` (zonas, pasillos, secciones, niveles)

---

## Variables de entorno

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `ALLOWED_ORIGINS` — lista de orígenes separados por coma
- `PORT`
- `NODE_ENV`

El backend carga `.env` en desarrollo vía `dotenv`.

---

## Notas de deployment

- Desarrollo: Vite como middleware dentro de Express.
- Producción: archivos estáticos servidos desde `dist/`.
- Headers de seguridad y rate-limiter básico en memoria están activos en el backend.
- Deploy en **Render** — configurado con `render.yaml`.

---

## PWA & Soporte Offline (Completado)

La transformación a PWA descrita en `docs/pwa_integration_plan.md` está completamente implementada:
- **Service Worker & Caching**: Automatizado con `vite-plugin-pwa` usando Workbox.
- **Control de Versiones**: Endpoint `/api/app-version` + banner `UpdateNotification.tsx` para recargas limpias en tiempo real.
- **Offline Database (IndexedDB)**: Tablas locales para almacenar catálogos (`productos`, `cajas`, `secciones`, `conceptos`, etc.) utilizando la base de datos IndexedDB `pwa-database` v2.
- **Cola de Transacciones**: Interceptor global de `window.fetch` para encolar peticiones de escritura fallidas por red (`POST`, `PUT`, `DELETE`) en IndexedDB, las cuales se sincronizan al recuperar conexión.

## Diseño Responsivo (Completado)
- Adaptaciones avanzadas para pantallas táctiles y móviles, optimizando filtros y tablas pesadas en pantallas pequeñas.
