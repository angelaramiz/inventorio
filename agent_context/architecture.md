# Architecture

**Última actualización:** 2026-06-26

---

## Visión General del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                     INVENTORIO ALPHA                        │
│                                                             │
│  ┌────────────────┐     ┌─────────────────────────────┐    │
│  │  App Web (PWA) │     │       Apps Móviles           │    │
│  │  React + Vite  │     │  Alpha (v1.0.6) | Conteo(v1.0.7)│ │
│  │  Render.com    │     │  Kotlin + Jetpack Compose    │    │
│  └───────┬────────┘     └──────────────┬───────────────┘   │
│          │  REST API                   │  REST API          │
│  ┌───────▼─────────────────────────────▼───────────────┐   │
│  │          Backend (Express + TypeScript)              │   │
│  │          server.ts  ~4300 líneas                     │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │             Supabase (PostgreSQL)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Frontend Web (PWA)

### Entry point
- `src/main.tsx` — renderiza la aplicación React.
- `src/App.tsx` — shell principal con navegación por tabs y routing basado en `window.location.pathname`.

### Vistas principales (tabs del shell)

| Tab | Componente | Descripción |
|---|---|---|
| Dashboard | `AlphaDashboardView` | Métricas rápidas del sistema |
| Escanear | `ScannerView` | Escáner continuo por cámara, lookup manual, registro rápido y asignación a contenedores. Busca cajas por `numero_caja`, `sku` o `id_caja` |
| Productos | `InventoryView` | Lista de stock, filtros, edición individual + edición grupal por `modelo_grupo` |
| Contenedores | `CajasView` | CRUD de contenedores, asignación a niveles, filtros por almacén |
| Conceptos | `ConceptosView` | Gestión dinámica de temporadas, tipos y sub-marcas |
| Almacén | `AlmacenView` | Gestión de zonas, pasillos, secciones y niveles; reportes de inventario |

### Vistas dedicadas (rutas propias)

| Ruta | Componente | Descripción |
|---|---|---|
| `/dashboard` | `ConsultaDashboard` | Dashboard de consultas y búsqueda de cajas/productos |
| `/pos` | `POSView` | Terminal POS para vendedores (Phase 2) |
| `/conteo_inv` | `InventoryControlView (operator)` | Conteo físico de inventario para operario (Phase 3) |
| `/admin` | `InventoryControlView (manager)` | Aprobaciones y reportes de conteo para gerente (Phase 3) |

### Componentes nuevos (Junio 2026)

| Componente | Descripción |
|---|---|
| `SyncStatusBadge.tsx` | Indica estado de sincronización PWA online/offline |
| `UpdateNotification.tsx` | Banner de actualización disponible (PWA Service Worker); llama a `skipWaiting()` para recargar limpio |

### Convenciones de UI
- Usa Tailwind CSS 4 con clases de respuesta móvil (`sm:`, `md:`, `lg:`).
- Componentes UI base importados desde `@/components/ui/*` (ShadCN) y `@base-ui/react`.
- Datos obtenidos con `fetch()` contra endpoints `/api/*`.
- Animaciones de transición de tabs con `motion/react` (`AnimatePresence`).
- Escáner de código de barras: `html5-qrcode` (en `ScannerView`, `POSView`, `ProductGroupEditModal`).

### PWA y Offline (Activo)
- **Service Worker**: gestionado por `vite-plugin-pwa` con Workbox.
- **IndexedDB**: Base `pwa-database` v2 — tablas locales de productos, cajas, secciones y conceptos.
- **Cola de escritura offline**: interceptor global de `window.fetch` para encolar POST/PUT/DELETE fallidos y reintentarlos al reconectarse.

---

## Backend

### Servidor
- `server.ts` — Express + Vite middleware. ~4,300 líneas.
- Contiene: headers de seguridad, CORS, parsing JSON, upload multipart (multer), rate limiting en memoria, OCR rate limiter separado.
- Supabase client cargado de forma lazy en el primer uso.
- **SSE (Server-Sent Events)**: eventos globales del dominio (cajas, productos, notificaciones de inventario) emitidos via `emitDomainEvent()`.

### Jerarquía de almacenamiento (5 niveles)

```
Almacén (Zona)
  └── Pasillo (Zona Intermedia)
        └── Sección (anaquel/mesa)
              └── Nivel (estante/piso)
                    └── Caja / Contenedor
                          └── Producto (item individual)
```

Cada nivel hereda `tags` (`tipo_producto`, `tipo_producto_exacto`, `genero`, `marca`, `temporada`) de su contenedor padre. Al actualizar etiquetas de un contenedor, el backend propaga los cambios al tipo de todos los productos que contiene.

---

### API Endpoints completos

#### App Version (OTA)
- `GET /api/android-version` — retorna versión actual de Android APK desde Supabase (tabla `android_version` y `android_version_conteo`). Usado por ambas apps móviles para verificar actualizaciones disponibles.

#### Productos
- `GET /api/productos` — lista productos con filtros (`q`, `marca`, `talla`, `temporada`, `tipo`, `modelo_grupo`).
- `POST /api/productos` — crear producto con foto opcional (multipart).
- `GET /api/productos/:id/image` — servir imagen binaria.
- `POST /api/productos/:id/async-image` — cola de upload asíncrono con compresión WebP.
- `GET /api/image-tasks/:taskId` — polling del estado del job de imagen asíncrono.
- `PUT /api/productos/group-edit` — edición express de atributos de grupo por `modelo_grupo` (multipart: foto, tipo, marca, temporada).
- `POST /api/productos/bulk-save` — guardado de ediciones avanzadas en tabla (SKU, EAN-13, talla) en una transacción.
- `PUT /api/productos/:id` — actualizar producto y/o foto.
- `DELETE /api/productos/:id` — eliminar producto.
- `POST /api/productos/grupo` — registro masivo de grupo de productos a un contenedor.

> ⚠️ **Orden importante en Express**: `/api/productos/group-edit` y `/api/productos/bulk-save` deben registrarse **ANTES** de `/api/productos/:id` para que Express no interprete la ruta como un `:id`.

#### Contenedores (Cajas)
- `GET /api/cajas` — lista cajas con filtros.
- `GET /api/cajas/suggested-prefixes` — sugerencias de prefijos disponibles.
- `GET /api/cajas/next-number` — siguiente número disponible en una serie.
- `POST /api/cajas` — crear nueva caja.
- `PUT /api/cajas/:id` — actualizar caja. **Al cambiar `tipo_producto_exacto`**, el backend propaga el cambio al campo `tipo` de todos los productos en esa caja.
- `DELETE /api/cajas/:id` — eliminar caja.
- `POST /api/cajas/:id/asignar` — asignar producto a caja.
- `GET /api/cajas/:id/productos` — productos dentro de una caja específica.
- `PUT /api/cajas/:id/productos/:id_producto` — actualizar cantidad de producto en caja.
- `POST /api/cajas/transferir-todo` — transferencia masiva atómica de todos los productos de una caja a otro destino (caja o nivel). Ejecutada en una transacción DB.

#### Jerarquía de almacén
- `GET /api/hierarchy` — árbol de contenedores jerárquico.
- `GET /api/hierarchy/settings` — ajustes del almacén (prefijos y secuencias).
- `PUT /api/hierarchy/settings` — actualizar prefijos y secuencias.
- `POST /api/hierarchy` — crear contenedor en jerarquía.
- `PUT /api/hierarchy/:id` — actualizar nodo.
- `DELETE /api/hierarchy/:id` — eliminar nodo.
- `GET /api/hierarchy/:id/stock-live` — SSE de tracking live de stock de un nodo.

#### Almacén (zonas, pasillos, secciones, niveles)
- `GET /api/almacen/product-counts` — conteo total de productos por nivel de jerarquía.
- `GET|POST|PUT|DELETE /api/almacen/zonas/:id`
- `GET|POST|PUT|DELETE /api/almacen/pasillos/:id`
- `GET|POST|PUT|DELETE /api/almacen/secciones/:id`
- `POST /api/almacen/secciones/bulk` — crear secciones en lote (prefijo + rango).
- `GET|POST|PUT|DELETE /api/almacen/niveles/:id`
- `POST /api/almacen/niveles/bulk` — crear niveles en lote.

#### Contenedores CJ-X (Phase 2)
- `POST /api/containers` — crear contenedor CJ-X.
- `POST /api/containers/transfer` — transferir e inherir identidad de caja dañada.

#### POS (Phase 2)
- `POST /api/pos/sell` — ejecutar transacción POS (deduce stock, registra ticket).

#### Control de Inventario / Conteo (Phase 3)
- `GET /api/inventory/events` — lista eventos de conteo.
- `POST /api/inventory/events` — crear evento de conteo.
- `POST /api/inventory/events/:id/finalizar` — cerrar y finalizar un evento de conteo.
- `GET /api/inventory/notifications` — notificaciones de gerente.
- `GET /api/inventory/notifications/sse` — SSE de notificaciones live.
- `POST /api/inventory/count-request` — operario envía cantidades de conteo físico. **Acepta tanto parámetros en español (`zona_id`, `detalles`, `inventario_evento_id`) como en inglés (`zone_id`, `cantidades`, `event_id`) para compatibilidad web/móvil.**
- `POST /api/inventory/operator-active` — notificar al gerente que operario está activo.
- `GET /api/inventory/count-requests` — lista de solicitudes de conteo enviadas.
- `POST /api/inventory/approvals` — aprobar o rechazar conteo de operario. **Al aprobar, actualiza el estado de la caja (`cajas.estado`) a `activa` o `vacia` según las unidades restantes.**
- `GET /api/inventory/reports` — reporte consolidado de inventario.

#### Ubicación y consultas
- `GET /api/verificar/:ean` — verificar existencia de producto por EAN/SKU y ubicación actual.
- `POST /api/transferir-producto` — mover cantidad entre cajas.
- `GET /api/reporte-inventario` — reporte de inventario por cajas.
- `GET /api/consultar-caja/:query` — consultar caja por número, SKU o id.
- `GET /api/consultar-seccion/:query` — consultar sección por query.
- `GET /api/consultar-producto/:query` — consultar cajas que contienen un producto.
- `GET /api/consultar-dinamico/:query` — búsqueda dinámica inteligente (IA en 2 pasos).

#### Conceptos
- `GET /api/conceptos/temporadas`, `POST`, `DELETE /api/conceptos/temporadas/:nombre`
- `GET /api/conceptos/tipos`, `POST`, `DELETE /api/conceptos/tipos/:nombre`
- `GET /api/conceptos/marcas`, `POST`, `DELETE /api/conceptos/marcas/:nombre`

#### Dashboard
- `GET /api/dashboard/stats` — estadísticas rápidas del sistema para el dashboard.

#### OCR
- `POST /api/ocr/extract-label` — extrae texto de etiqueta de foto para auto-completar registro. Rate limiter independiente activo.

#### Eventos globales
- `GET /api/events/stream` — SSE global del dominio (eventos de cajas, productos, etc.).

---

## Apps Móviles (Android)

### Estructura local
```
apps movil/
  ├── inventorio alpha/     # App para gerentes/administradores
  └── inventorio conteo/    # App para operarios de conteo físico
```

### Inventorio Alpha
- **Versión actual:** `1.0.6` (versionCode 7)
- **Namespace:** `com.inventorio.alpha`
- **Stack:** Kotlin + Jetpack Compose + CameraX + ML Kit Barcode + Coil
- **Pantallas:** Dashboard, Productos, Cajas, Consulta, Almacén, Conceptos, Escáner
- **Actualización OTA:** Auto-update al inicio via `GET /api/android-version`. Descarga APK con prefijo de timestamp para evitar caché del instalador. Limpia versiones antiguas antes de descargar.
- **Botón manual:** "Comprobar actualización" disponible en la UI.
- **Coil:** ImageLoader con disk cache + memory cache configurado en `MainActivity.kt`.

### Inventorio Conteo
- **Versión actual:** `1.0.7` (versionCode 8)
- **Namespace:** `com.inventorio.conteo`
- **Stack:** Kotlin + Jetpack Compose + CameraX + ML Kit Barcode + Coil
- **Pantallas:** Conteo físico (`ConteoView`), Consulta (`ConsultaView`)
- **Actualización OTA:** Auto-update idéntico al de Alpha via tabla `android_version_conteo`.
- **Botón manual:** "Comprobar actualización" disponible en la UI.
- **Conteo en niveles vacíos:** Soporta placeholder temporal `TEMP-NV-{nivel_id}` para confirmar conteo en niveles sin stock previo.
- **Coil:** ImageLoader con disk cache + memory cache configurado en `MainActivity.kt`.

### Script de publicación OTA
- `extras/publish_ota.ps1` — compila, copia APK al directorio `public/` del servidor, registra la versión en Supabase y hace commit + push a Git (con `-f` para forzar archivos ignorados).
- `extras/publish_conteo_ota.ps1` — idéntico pero para la app Conteo.

---

## Capa de datos (Supabase)

- Tablas principales: `productos`, `cajas`, `caja_productos`, `zonas`, `pasillos`, `secciones`, `zonas_nivel`, `count_requests`, `inventory_events`, `android_version`, `android_version_conteo`.
- Imágenes de productos: almacenadas como buffer binario → string hex en Postgres.
- El backend normaliza ciertos nombres de marcas al arrancar.
- `src/utils/db.ts` — IndexedDB para historial local de consultas de cajas (browser-only).

---

## Build y runtime

- `npm run dev` — Vite con Express middleware (tsx).
- `npm run build` — Vite frontend + esbuild server.ts → `dist/`.
- `npm start` — servidor de producción desde `dist/server.cjs`.

---

## Config importante

- `tsconfig.json` — alias `@/*` para imports del proyecto (resuelve a la raíz del proyecto).
- `vite.config.ts` — plugin de React + Tailwind, alias `@`, code splitting manual (`react-deps`, `ui-components`).

---

## Guías de diseño obligatorias

- **Mobile-first**: UI optimizada para pantallas pequeñas (320px+). Usar breakpoints responsivos.
- Tamaños de texto base `text-xs` o `text-[10px]` en mobile, `md:text-sm` en desktop.
- Modales: `max-w-[95vw]` y `max-h-[90vh]` con scroll habilitado.
- Touch targets mínimo 44px.
- Estética **glassmorphic / dark premium**: colores oscuros neutros (`neutral-950`, `neutral-900`), gradientes suaves, micro-animaciones.
- Preferir `min-h-0` en columnas de grid para que `overflow-y-auto` funcione correctamente.
