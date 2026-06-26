# File Mapping

Mapa actualizado de los archivos importantes del proyecto y sus responsabilidades.

**Última actualización**: Junio 2026

---

## Archivos raíz

| Archivo | Descripción |
|---|---|
| `server.ts` | Backend Express: todas las API routes, seguridad, CORS, Supabase client, upload multipart, rate limiting, SSE, OCR. **~4,300 líneas** — el archivo más grande del proyecto. |
| `package.json` | Dependencias, scripts. |
| `tsconfig.json` | Config TypeScript + alias `@/*` → raíz del proyecto. |
| `vite.config.ts` | Vite: plugins React + Tailwind + PWA, alias `@`, code splitting. HMR controlado por `DISABLE_HMR`. |
| `index.html` | Entry point HTML de la SPA. |
| `render.yaml` / `render.yml` | Configuración de deploy en Render. |

---

## Archivos de fuente frontend

| Archivo | Descripción |
|---|---|
| `src/main.tsx` | Entry point de React. Registra el Service Worker de PWA. |
| `src/App.tsx` | Shell principal: routing por pathname, tabs, layout, `AnimatePresence` para transiciones. Monta `ImageLightbox` global. |
| `src/index.css` | Estilos globales y directivas Tailwind. |
| `src/types.ts` | Interfaces y tipos TypeScript compartidos del dominio. |
| `src/utils/db.ts` | Wrapper de IndexedDB para historial de consultas de cajas y base `pwa-database` v2 (offline). |

---

## Componentes (src/components/)

| Componente | Descripción |
|---|---|
| `ScannerView.tsx` | Escáner continuo por cámara (html5-qrcode), búsqueda manual, registro rápido, asignación a contenedores. **Busca cajas por `numero_caja`, `sku` o `id_caja`** (fix Junio 2026). El escáner se detiene al detectar un código y se reactiva al guardar/cancelar. Incluye selector jerárquico paso a paso. |
| `InventoryView.tsx` | Lista de inventario/stock con filtros (tipo, marca, talla, temporada, búsqueda libre). Botón "Editar Grupo" que abre `ProductGroupEditModal`. |
| `CajasView.tsx` | Vista de **Contenedores**. CRUD de contenedores, filtros por almacén. |
| `CajaDetailsModal.tsx` | Modal de detalles del contenedor: muestra productos, permite editar etiquetas, botón "Transferir Todo" con wizard jerárquico. |
| `ProductGroupEditModal.tsx` | Modal de edición grupal por `modelo_grupo`. Tabs: Edición Express y Edición Avanzada (tabla editable: SKU, EAN-13, talla). Incluye escáner de cámara para auto-detectar modelo. |
| `ProductEditModal.tsx` | Modal de edición individual de producto con foto. |
| `ProductQuickRegister.tsx` | Formulario de registro rápido de producto. Incluye autocompletado desde foto vía OCR. |
| `AlmacenView.tsx` | Gestión de zonas, pasillos, secciones y niveles (~250KB, el componente más grande). |
| `ConceptosView.tsx` | Gestión de conceptos dinámicos: temporadas, tipos, sub-marcas. |
| `ConsultaDashboard.tsx` | Dashboard de consulta de cajas y productos con historial (IndexedDB). |
| `AlphaDashboardView.tsx` | Dashboard con métricas rápidas del sistema. |
| `HierarchyView.tsx` | Visualizador de árbol de jerarquía y generador de etiquetas Code128. |
| `POSView.tsx` | Terminal POS (Phase 2): checkout para vendedor. |
| `InventoryControlView.tsx` | Control de inventario físico (Phase 3): calendar, conteo por operario, aprobaciones por gerente. |
| `AsyncImageUploader.tsx` | Compresor cliente WebP + uploader asíncrono con progreso en segundo plano. |
| `ImageLightbox.tsx` | Overlay de preview de imágenes (global, montado en App.tsx). |
| `SyncStatusBadge.tsx` | **[NUEVO]** Badge de estado de conexión/sincronización PWA. |
| `UpdateNotification.tsx` | **[NUEVO]** Banner de actualización disponible: detecta nuevo Service Worker y permite recargar la app sin caché. |

---

## Apps Móviles (apps movil/)

| Archivo | Descripción |
|---|---|
| `apps movil/inventorio alpha/` | App Android para gerentes/administradores. |
| `apps movil/inventorio alpha/app/build.gradle.kts` | Config de build: versión `1.0.6` (code 7), SDK 36, dependencias (Coil, MLKit, CameraX). |
| `apps movil/inventorio alpha/app/src/.../MainActivity.kt` | Entry point + navegación + OTA auto-update + Coil ImageLoader con disk/memory cache. |
| `apps movil/inventorio alpha/app/src/.../ScannerView.kt` | Escáner de cámara + búsqueda de productos. |
| `apps movil/inventorio alpha/app/src/.../ProductsView.kt` | Lista y filtros de productos. |
| `apps movil/inventorio alpha/app/src/.../CajasView.kt` | Lista y detalle de contenedores. |
| `apps movil/inventorio alpha/app/src/.../ConsultaView.kt` | Consulta de cajas/productos. |
| `apps movil/inventorio alpha/app/src/.../AlmacenView.kt` | Gestión de jerarquía de almacén. |
| `apps movil/inventorio alpha/app/src/.../ConceptosView.kt` | Gestión de conceptos (temporadas, tipos, marcas). |
| `apps movil/inventorio conteo/` | App Android para operarios de conteo físico. |
| `apps movil/inventorio conteo/app/build.gradle.kts` | Config de build: versión `1.0.7` (code 8), SDK 36, dependencias (Coil, MLKit, CameraX). |
| `apps movil/inventorio conteo/app/src/.../MainActivity.kt` | Entry point + navegación + OTA auto-update + Coil ImageLoader. |
| `apps movil/inventorio conteo/app/src/.../ConteoView.kt` | Flujo de conteo físico por nivel. Incluye placeholder temporal `TEMP-NV-{id}` para niveles vacíos. |
| `apps movil/inventorio conteo/app/src/.../ConsultaView.kt` | Consulta de productos/cajas. |

---

## Scripts de publicación (extras/)

| Archivo | Descripción |
|---|---|
| `extras/publish_ota.ps1` | PowerShell: compila Alpha, copia APK a `public/`, registra versión en Supabase, commit + push con `-f`. |
| `extras/publish_conteo_ota.ps1` | PowerShell: idéntico para la app Conteo. |

---

## Documentación (docs/)

| Archivo | Descripción |
|---|---|
| `pwa_integration_plan.md` | Plan completado de integración PWA y sistema de versionamiento. |
| `supabase_schema.sql` | Schema principal de Supabase/Postgres. |
| `migration.sql` | Migración inicial del schema. |
| `migration_hierarchy.sql` | Cambios de schema para la jerarquía. |
| `migration_boxes_to_niveles.sql` | Migración de cajas a la tabla `zonas_nivel`. |
| `migration_registro_salidas.sql` | Migración para registro de salidas. |
| `supabase_migrations_new.sql` | Migraciones nuevas adicionales. |
| `supabase_migrations_pasillo.sql` | Migraciones para pasillos. |
| `supabase_migrations_tags.sql` | Migraciones para el sistema de etiquetas/tags. |
| `PRODUCTION_GUIDE.md` | Guía de producción y pasos de validación. |
| `PRODUCTION_CHECKLIST.md` | Lista de verificación de producción. |

---

## Archivos de producción y deploy

| Archivo | Descripción |
|---|---|
| `render.yaml` / `render.yml` | Config de deploy en Render. |
| `public/` | APKs publicados para descarga OTA por las apps móviles. |
| `.env.example` / `.env.production` | Ejemplos de variables de entorno. |

---

## Notas para agentes de IA

- Usar el alias `@` en el frontend: `@/components/...`, `@/components/ui/...`.
- Preferir modificar componentes existentes vs. crear nuevos.
- Mantener alineados los contratos de datos entre frontend y backend.
- Al agregar un endpoint nuevo, documentarlo en `agent_context/architecture.md`.
- **OPTIMIZACIÓN MÓVIL**: Toda modificación de UI debe funcionar en pantallas ≥320px. Touch targets ≥44px, modales con scroll, texto legible en mobile.
- **ORDEN DE RUTAS EN EXPRESS**: Siempre registrar rutas específicas como `/api/productos/group-edit` y `/api/productos/bulk-save` **ANTES** de rutas con parámetros como `/api/productos/:id`.
- **SCROLL EN GRIDS**: Usar `min-h-0` en columnas de CSS grid para que `overflow-y-auto` funcione correctamente.
- El escáner `html5-qrcode` debe iniciarse y detenerse de forma controlada. **No iniciar múltiples instancias simultáneas** para evitar bloqueos del recurso de cámara.
- **APPS MÓVILES**: Los archivos bajo `apps movil/` están excluidos del `.gitignore`. Usar `git add -f` para forzar el commit de archivos de ese directorio.
- **OTA MÓVIL**: Siempre usar `extras/publish_ota.ps1` o `publish_conteo_ota.ps1` para publicar una nueva versión. Nunca instalar por USB en producción.
