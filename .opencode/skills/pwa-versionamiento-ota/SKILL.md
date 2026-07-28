---
name: pwa-versionamiento-ota
description: |
  Plantilla para implementar un sistema completo de versionamiento, actualización OTA (Over-The-Air) y notificación de versiones en PWAs con Vite + React + TypeScript + Workbox.
  Incluye: detección automática de nuevas versiones via Service Worker, notificación visual glassmorphic, offline queue con IndexedDB, caché de API con NetworkFirst, y sincronización diferida.
  Usar cuando el proyecto requiera actualización automática sin pase por tienda de apps, o cuando necesite funcionalidad offline-offline-first con sincronización.
  Tecnologías: vite-plugin-pwa, Workbox, IndexedDB (idb), Service Worker con registerType 'prompt'.
---

# 🧬 Plantilla: Sistema de Versionamiento y OTA para PWA (Web)

> **Versión:** 1.0.0
> **Propósito:** Proveer un sistema completo, reutilizable y detallado de actualización OTA + notificación + offline-first para cualquier proyecto PWA basado en Vite + React + TypeScript.
> **Inspirado en:** Implementación real de Inventorio Alpha (inventario físico para tiendas de ropa).

---

## 📋 Tabla de Contenidos

1. [Conceptos Fundamentales](#-conceptos-fundamentales)
2. [Arquitectura General](#-arquitectura-general)
3. [Diagramas de Flujo](#-diagramas-de-flujo)
4. [Implementación Paso a Paso](#-implementación-paso-a-paso)
   - 4.1 Instalación de dependencias
   - 4.2 Configuración de Vite + PWA
   - 4.3 Componente UpdateNotification
   - 4.4 Integración en App.tsx
   - 4.5 Endpoint de versión en servidor
   - 4.6 Sistema offline queue
   - 4.7 Service Worker avanzado
5. [Referencia de Configuración](#-referencia-de-configuración)
6. [Estrategias de Cacheo](#-estrategias-de-cacheo)
7. [Mejores Prácticas y Anti-Patrones](#-mejores-prácticas-y-anti-patrones)

---

## 🧠 1. Conceptos Fundamentales

### ¿Qué es un PWA con actualización OTA?

Una **Progressive Web App (PWA)** es una aplicación web que puede instalarse en el dispositivo del usuario y funcionar offline. El **Service Worker (SW)** es el núcleo: un script que corre en segundo plano, intercepta requests, y gestiona cachés.

Cuando el usuario abre la app por primera vez, el SW se instala y cachea los archivos estáticos (JS, CSS, HTML, imágenes). En visitas posteriores, el SW sirve estos archivos desde caché — pero **¿cómo sabe el usuario que hay una versión nueva?**

El flujo OTA (Over-The-Air):

```
[Build nuevo deployado] 
       ↓
[SW detecta cambio] → [Notifica al usuario] → [Usuario acepta] → [Reload + nuevo SW activo]
```

### Componentes clave

| Componente | Rol |
|------------|-----|
| `vite-plugin-pwa` | Genera el SW automáticamente en el build |
| `Workbox` | Biblioteca de Google para manejo de caché en SW |
| `virtual:pwa-register/react` | Hook React que expone `needRefresh` y `updateServiceWorker` |
| `IndexedDB (idb)` | Almacenamiento offline estructurado en el navegador |
| `registerType: 'prompt'` | El SW nuevo espera confirmación antes de activarse |
| `NetworkFirst` | Estrategia: intenta red primero, cae a caché si falla |
| `StaleWhileRevalidate` | Estrategia: sirve caché inmediato, actualiza en background |

### Diferencias entre registerType

| registerType | Comportamiento |
|---|---|
| `'autoUpdate'` | El SW nuevo se activa automáticamente SILENCIOSAMENTE. El usuario no se entera — pero puede causar inconsistencias si está en medio de una operación. |
| `'prompt'` | El SW nuevo espera. El hook `useRegisterSW` expone `needRefresh` para que el frontend decida CUÁNDO y CÓMO mostrar la notificación. |
| `'autoUpdate' + onNeedRefresh` | Similar a prompt pero más limitado. |

**Nuestra elección:** `'prompt'`, porque queremos control total sobre la UX de la actualización.

---

## 🏗️ 2. Arquitectura General

### Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                        NAVEGADOR                                │
│                                                                  │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │   App.tsx     │    │ UpdateNotifictn  │    │  pwaDb.ts     │ │
│  │  (Root UI)    │───▶│ (Toast Update)   │    │ (IndexedDB)   │ │
│  └──────┬───────┘    └──────────────────┘    └───────┬───────┘ │
│         │                                             │         │
│         ▼                                             ▼         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Service Worker (sw.js)                       │   │
│  │  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │ Precache   │  │ RuntimeCache │  │  Update Detect   │  │   │
│  │  │ (static)   │  │ (API/Images) │  │  (hash changed)  │  │   │
│  │  └────────────┘  └──────────────┘  └──────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SERVIDOR                                  │
│                                                                  │
│  ┌──────────────────────┐   ┌───────────────────────────────┐   │
│  │  GET /api/app-version│   │  API Routes (/api/productos,  │   │
│  │  (return pkg.version)│   │  /api/cajas, etc.)           │   │
│  └──────────────────────┘   └───────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Build Output (dist/)                                       │  │
│  │  ├── index.html                                             │  │
│  │  ├── assets/index-abc123.js   ← hash cambia en cada build  │  │
│  │  ├── assets/index-xyz789.css  ← hash cambia en cada build  │  │
│  │  ├── sw.js                     ← servicio worker           │  │
│  │  └── workbox-*.js             ← runtime de Workbox         │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo de datos simplificado

```
    Usuario                     SW                     Servidor
       │                        │                        │
       │───[1] Abre app────────▶│                        │
       │                        │───[2] Fetch index.html─▶│
       │                        │◀──[3] HTML+JS+CSS──────│
       │◀──[4] Renderiza───────│                        │
       │                        │                        │
       │                        │───[5] Cachea archivos──│
       │                        │                        │
  ─────┼──────────── T I E M P O ────────────────────────┼────
       │                        │                        │
       │   (developer deploya nueva versión)             │
       │                        │                        │
       │───[6] Abre app (días) ▶│                        │
       │                        │───[7] HEAD /sw.js──────▶│
       │                        │◀──[8] 200 (byte diferente)│
       │                        │                        │
       │                        │───[9] Descarga nuevo SW│
       │                        │                        │
       │◀──[10] needRefresh=true│                        │
       │                        │                        │
       │───[11] Usuario ve toast│                        │
       │───[12] Click "Actualizar"                      │
       │───[13] updateSW(true)──▶│                        │
       │                        │───[14] skipWaiting()───│
       │◀──[15] controllerchange│                        │
       │───[16] reload()───────▶│                        │
       │                        │───[17] Servir nuevo───▶│
```

---

## 🔄 3. Diagramas de Flujo

### 3.1 Flujo de detección de actualización

```
                  ┌──────────────┐
                  │  App inicia  │
                  └──────┬───────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  useRegisterSW()    │
              │  Registra SW        │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐       NO
              │  ¿SW registrado?    │──────────▶ Fin
              └──────────┬──────────┘
                         │ SÍ
                         ▼
              ┌─────────────────────┐
              │  setInterval(30min) │
              │  r.update()          │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐       NO
              │  ¿Nuevo SW         │──────────▶ Espera 30min
              │  detectado?        │
              └──────────┬──────────┘
                         │ SÍ
                         ▼
              ┌─────────────────────┐
              │  needRefresh = true │
              │  (useRegisterSW     │
              │   lo notifica)      │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────────────────────┐
              │  UpdateNotification se renderiza    │
              │  Toast glassmorphic:                │
              │  "Actualización Disponible"         │
              │  [Ignorar] [Actualizar]             │
              └──────────────────┬──────────────────┘
                         │                │
                 ┌───────┘                └───────┐
                 ▼                                ▼
        ┌─────────────────┐           ┌─────────────────────┐
        │  Click Ignorar  │           │  Click Actualizar   │
        └────────┬────────┘           └──────────┬──────────┘
                 │                               │
                 ▼                               ▼
        ┌─────────────────┐           ┌─────────────────────┐
        │  setNeedRefresh │           │  updateSW(true)     │
        │  = false        │           │  = skipWaiting()    │
        │  (oculta toast) │           └──────────┬──────────┘
        └─────────────────┘                      │
                                                  ▼
                                        ┌─────────────────────┐
                                        │  controllerchange   │
                                        │  event fires        │
                                        └──────────┬──────────┘
                                                     │
                                                     ▼
                                        ┌─────────────────────┐
                                        │  window.location     │
                                        │  .reload()          │
                                        │  (app con nueva     │
                                        │   versión)          │
                                        └─────────────────────┘
```

### 3.2 Flujo offline queue (escrituras diferidas)

```
                  ┌──────────────┐
                  │  Operación   │
                  │  POST/PUT    │
                  │  /DELETE     │
                  └──────┬───────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  navigator.onLine?  │
              └──────┬──────┬───────┘
                     │      │
                   SÍ      NO
                     │      │
                     ▼      ▼
              ┌────────┐  ┌──────────────────────┐
              │ Fetch  │  │ enqueueRequest()      │
              │ normal │  │ Guarda en IndexedDB   │
              └───┬────┘  │ "offline-queue"       │
                  │       │ toast warning         │
                  ▼       └──────────┬───────────┘
             ┌─────────┐             │
             │ ¿éxito? │             │
             └──┬──────┘             │
            SÍ  │  NO                │
             │  │                    │
             ▼  ▼                    │
          Fin  ┌─────────┐           │
               │enqueue  │           │
               │Request()│           │
               └────┬────┘           │
                    │                │
                    ▼                ▼
                    ┌─────────────────────┐
                    │  window.online      │
                    │  event detecta      │
                    │  reconexión         │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ syncOfflineQueue()   │
                    │ Itera cola FIFO     │
                    │ POST cada request   │
                    │ al servidor          │
                    └──────┬──────┬───────┘
                           │      │
                        éxito  error
                           │      │
                           ▼      ▼
                    ┌────────┐  ┌──────────────────┐
                    │clearQ  │  │ break (detiene   │
                    │ueueItem│  │ cola, reintenta  │
                    │        │  │ luego)           │
                    └────────┘  └──────────────────┘
```

### 3.3 Estrategia de caché por tipo de recurso

```
┌────────────────────────────────────────────────────────────────┐
│                    RUTEO DE SERVICIO (SW)                       │
├────────────┬──────────────────┬─────────────────┬──────────────┤
│  Recurso   │  Estrategia      │  Cache Name     │  TTL         │
├────────────┼──────────────────┼─────────────────┼──────────────┤
│  Estáticos │  precache        │  precache       │  forever     │
│  (*.js,    │  (se descargan   │                 │  (solo cambia│
│   *.css,   │   al instalar)   │                 │   con nuevo  │
│   .html)   │                  │                 │   SW)        │
├────────────┼──────────────────┼─────────────────┼──────────────┤
│  API       │  NetworkFirst    │  api-cache      │  24h         │
│  (GET)     │  (intenta red,   │                 │              │
│            │   cae a caché)   │                 │              │
├────────────┼──────────────────┼─────────────────┼──────────────┤
│  Imágenes  │  StaleWhile      │  product-images │  30 días     │
│  producto  │  Revalidate      │  -cache        │              │
│            │  (caché + fondo)  │                 │              │
├────────────┼──────────────────┼─────────────────┼──────────────┤
│  POST/     │  No cache        │  —              │  —           │
│  PUT/DELETE│  (pasan directo  │                 │              │
│            │   al servidor)   │                 │              │
└────────────┴──────────────────┴─────────────────┴──────────────┘
```

---

## 💻 4. Implementación Paso a Paso

### 4.1 Instalación de dependencias

```bash
npm install vite-plugin-pwa workbox-precaching workbox-routing workbox-strategies
npm install idb                     # IndexedDB wrapper (para offline queue)
```

> **Nota:** `workbox-*` ya vienen incluidas en `vite-plugin-pwa`. Solo necesitas instalar `vite-plugin-pwa` y `idb`.

### 4.2 Configuración de Vite + PWA

**Archivo:** `vite.config.ts`

```typescript
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // === REGISTRATION ===
      registerType: 'prompt',    // ← CLAVE: el SW no se activa solo, espera al usuario

      // === MANIFEST ===
      manifest: {
        name: 'Nombre de tu App',
        short_name: 'App',
        description: 'Descripción de la app',
        theme_color: '#0a0a0a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      // === WORKBOX (generación automática del SW) ===
      workbox: {
        // Archivos a precachear (se cachean al instalar el SW)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],

        // Estrategias de runtime caching (API, imágenes, etc.)
        runtimeCaching: [
          {
            // API endpoints: NetworkFirst (intenta red, cae a caché)
            urlPattern: /^\/api\/(productos|cajas|almacen|conceptos|verificar)/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 24 * 60 * 60,  // 24 horas
              },
              networkTimeoutSeconds: 5,
            },
          },
          {
            // Imágenes de productos: StaleWhileRevalidate
            urlPattern: /^\/api\/productos\/\d+\/image/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'product-images-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60,  // 30 días
              },
            },
          },
        ],
      },
    }),
  ],
});
```

#### Explicación de cada campo

| Campo | Valor | ¿Por qué? |
|-------|-------|-----------|
| `registerType` | `'prompt'` | El nuevo SW no se activa solo. Permite al frontend mostrar la notificación y que el usuario decida cuándo recargar. |
| `globPatterns` | `['**/*.{js,css,...}']` | Solo archivos estáticos. APIs e imágenes usan estrategias runtime, no precache. |
| `runtimeCaching[].handler` | `'NetworkFirst'` | Las APIs deben mostrar datos actualizados si hay red. Solo usan caché como respaldo. |
| `runtimeCaching[].networkTimeoutSeconds` | `5` | Si la red tarda >5s, usa caché. Evita que la app se quede cargando eternamente. |
| `runtimeCaching[].expiration.maxAgeSeconds` | `86400` (24h) | Los datos de API no deben ser muy viejos. El usuario siempre ve info reciente. |

### 4.3 Componente UpdateNotification

**Archivo:** `src/components/UpdateNotification.tsx`

```typescript
import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

/**
 * UpdateNotification
 *
 * Componente que se monta GLOBALMENTE en la app.
 * Escucha el estado needRefresh del Service Worker y muestra un toast
 * cuando hay una nueva versión disponible.
 *
 * Comportamiento:
 * - Detecta automáticamente nuevas versiones (cada 30 min via setInterval)
 * - Muestra un toast glassmorphic fijo en la esquina inferior derecha
 * - El usuario puede ignorar (se oculta hasta la próxima detección)
 *   o actualizar (activa el nuevo SW y recarga la página)
 * - Si el SW no se activa después de 1.5s, fuerza reload como fallback
 */
export default function UpdateNotification() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Se ejecuta UNA VEZ cuando el SW se registra exitosamente
      console.log("Service Worker registrado con éxito");

      // Polling cada 30 minutos para detectar actualizaciones
      if (r) {
        setInterval(() => {
          r.update().catch(err =>
            console.debug("Error checking SW update:", err)
          );
        }, 30 * 60 * 1000); // 30 minutos
      }
    },
    onRegisterError(error) {
      console.error("Error al registrar el Service Worker:", error);
    },
  });

  // Escucha el evento 'controllerchange' que se dispara cuando el nuevo SW
  // toma el control. Si no se dispara en 1.5s, el botón Actualizar lo fuerza.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      const handleControllerChange = () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      };
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        handleControllerChange
      );
      return () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange
        );
      };
    }
  }, []);

  const handleUpdate = async () => {
    try {
      await updateServiceWorker(true); // → skipWaiting() → activa nuevo SW
      setTimeout(() => {
        window.location.reload(); // fallback si controllerchange no se dispara
      }, 1500);
    } catch (err) {
      console.error("Error updating Service Worker, forcing reload:", err);
      window.location.reload();
    }
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-24 right-4 md:bottom-6 md:right-6 z-[100] max-w-sm w-[calc(100%-2rem)] md:w-full bg-white/90 backdrop-blur-md border border-neutral-200/80 rounded-3xl p-5 shadow-2xl animate-in fade-in slide-in-from-bottom-5 duration-350 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="bg-neutral-900 text-white p-2.5 rounded-2xl flex items-center justify-center shrink-0">
            <RefreshCw size={18} className="animate-spin-slow" />
          </div>
          <div>
            <h4 className="text-sm font-black text-neutral-900 uppercase tracking-tight">
              Actualización Disponible
            </h4>
            <p className="text-xs text-neutral-500 font-medium mt-0.5 leading-relaxed">
              Hay una nueva versión del sistema disponible con mejoras y
              correcciones.
            </p>
          </div>
        </div>
        <button
          onClick={() => setNeedRefresh(false)}
          className="text-neutral-450 hover:text-neutral-800 transition-colors p-1 rounded-lg hover:bg-neutral-100/50"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={() => setNeedRefresh(false)}
          className="px-3.5 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:text-neutral-900 transition-colors hover:bg-neutral-100/60"
        >
          Ignorar
        </button>
        <button
          onClick={handleUpdate}
          className="px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-neutral-800 transition-all flex items-center gap-1.5 shadow-md shadow-neutral-900/10"
        >
          <RefreshCw size={12} />
          Actualizar
        </button>
      </div>
    </div>
  );
}
```

#### ⚠️ Puntos críticos del componente

1. **`setInterval` de 30 min**: El polling no es ideal pero es necesario porque el navegador solo verifica el SW cuando el usuario navega a la app. Con `setInterval` nos aseguramos que aunque la app esté abierta todo el día, eventualmente detecte cambios.

2. **`controllerchange` listener**: Cuando el SW llama a `skipWaiting()`, el navegador dispara `controllerchange`. Escuchamos esto para recargar la página automáticamente. Sin este listener, la app seguiría usando el SW viejo aunque el nuevo esté instalado.

3. **Fallback `setTimeout(1500)`**: Si `updateServiceWorker(true)` funciona pero `controllerchange` no se dispara (edge case de algunos navegadores), recargamos de todas formas después de 1.5s.

4. **`refreshing` flag**: Evita la doble recarga en caso de que `controllerchange` se dispare múltiples veces.

### 4.4 Integración en App.tsx

**Archivo:** `src/App.tsx`

```typescript
import UpdateNotification from "./components/UpdateNotification";

export default function App() {
  return (
    <>
      {/* ... tu layout existente ... */}
      <Routes>
        <Route path="/" element={<Home />} />
        {/* etc */}
      </Routes>

      {/* ← ÚNICA LÍNEA QUE AGREGAS */}
      <UpdateNotification />
    </>
  );
}
```

> **IMPORTANTE:** `UpdateNotification` debe montarse SIEMPRE, esté o no el usuario autenticado, en todas las rutas. Si solo se monta en una ruta protegida, el usuario vería la notificación solo si ya inició sesión. El SW aplica a toda la app independientemente de auth.

### 4.5 Endpoint de versión en servidor

**Archivo:** `server.ts`

```typescript
// GET /api/app-version — Devuelve la versión actual del frontend deployado
// Útil para debugging y para que el backend sepa qué versión está corriendo.
app.get('/api/app-version', (req, res) => {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    res.json({ version: pkg.version || '0.0.0' });
  } catch (error: any) {
    res.status(500).json({ error: 'No se pudo leer la versión de la aplicación' });
  }
});
```

> **Nota:** Este endpoint NO es usado por el SW para detectar actualizaciones (Workbox lo hace comparando hashes de los archivos). Es puramente informativo. Puedes usarlo para mostrar la versión en un footer, o para debugging.

### 4.6 Sistema offline queue (opcional pero recomendado)

**Archivo:** `src/utils/pwaDb.ts`

```typescript
import { openDB, IDBPDatabase } from "idb";
import { toast } from "sonner";

const DB_NAME = "nombre-app-db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("catalogs");          // caché offline de catálogos
          db.createObjectStore("offline-queue", {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      },
    });
  }
  return dbPromise;
}

// ─── CACHÉ DE CATÁLOGOS ──────────────────────────────────────────

export async function saveCatalog(key: string, data: any[]) {
  try {
    const db = await getDB();
    await db.put("catalogs", data, key);
  } catch (err) {
    console.error(`Error al guardar catálogo ${key} en IndexedDB:`, err);
  }
}

export async function getCatalog(key: string): Promise<any[] | null> {
  try {
    const db = await getDB();
    const data = await db.get("catalogs", key);
    return data || null;
  } catch (err) {
    console.error(`Error al leer catálogo ${key} desde IndexedDB:`, err);
    return null;
  }
}

export async function fetchCatalogWithCache(
  path: string,
  key: string
): Promise<any[]> {
  try {
    const resp = await fetch(path);
    if (resp.ok) {
      const data = await resp.json();
      await saveCatalog(key, data);
      return data;
    }
  } catch (err) {
    console.warn(`Error de red al obtener ${key}, usando caché local:`, err);
  }
  const cached = await getCatalog(key);
  return cached || [];
}

// ─── OFFLINE QUEUE ─────────────────────────────────────────────--

export interface OfflineRequest {
  id?: number;
  url: string;
  method: string;
  body: any;
  timestamp: number;
}

export async function enqueueRequest(url: string, method: string, body: any) {
  try {
    const db = await getDB();
    const request: OfflineRequest = { url, method, body, timestamp: Date.now() };
    await db.add("offline-queue", request);
    window.dispatchEvent(new CustomEvent("offline-queue-changed"));
  } catch (err) {
    console.error("Error al encolar petición offline:", err);
  }
}

export async function getOfflineQueue(): Promise<OfflineRequest[]> {
  try {
    const db = await getDB();
    return await db.getAll("offline-queue");
  } catch (err) {
    console.error("Error al obtener cola offline:", err);
    return [];
  }
}

export async function clearQueueItem(id: number) {
  try {
    const db = await getDB();
    await db.delete("offline-queue", id);
    window.dispatchEvent(new CustomEvent("offline-queue-changed"));
  } catch (err) {
    console.error(`Error al borrar item ${id} de la cola offline:`, err);
  }
}

let isSyncing = false;

export async function syncOfflineQueue() {
  if (isSyncing) return;
  const queue = await getOfflineQueue();
  if (queue.length === 0) return;

  isSyncing = true;
  const toastId = toast.loading(
    `Sincronizando ${queue.length} operación(es) pendiente(s)...`
  );

  let successCount = 0;
  for (const req of queue) {
    try {
      const resp = await fetch(req.url, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
      if (resp.ok) {
        if (req.id !== undefined) {
          await clearQueueItem(req.id);
          successCount++;
        }
      } else {
        console.error("Error en respuesta al sincronizar:", await resp.text());
        break; // Detiene la cola para no perder órdenes
      }
    } catch (err) {
      console.error("Error de red durante sincronización offline:", err);
      break;
    }
  }

  isSyncing = false;
  toast.dismiss(toastId);

  if (successCount > 0) {
    toast.success(
      `¡Sincronización completa! ${successCount} operación(es) enviada(s) al servidor.`
    );
    window.dispatchEvent(new CustomEvent("sync-success"));
  }
}

// Auto-sincronizar al reconectarse
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncOfflineQueue();
  });
}
```

#### Cómo usar la offline queue

```typescript
// En lugar de fetch() para escrituras:
import { offlineFetch } from "./utils/pwaDb";

// Si hay red: funciona normal
// Si no hay red: guarda en IndexedDB, muestra toast, devuelve 200 fake
const resp = await offlineFetch("/api/productos", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(producto),
});
```

#### Diagrama de flujo de datos de la offline queue

```
              TIEMPO DE EJECUCIÓN
                │
    POST /api/productos
      │
      ├─── online ──▶ fetch() ──▶ servidor ──▶ 200 OK
      │                               │
      │                               └── Fin
      │
      └─── offline ──▶ enqueueRequest()
                           │
                           ▼
                    IndexedDB "offline-queue"
                    ┌─────────────────────┐
                    │ { id:1, url, body } │
                    │ { id:2, url, body } │
                    └─────────────────────┘
                           │
                    ──── horas después ────
                           │
                    window.addEventListener("online")
                           │
                           ▼
                    syncOfflineQueue()
                           │
                    ┌──────┴──────┐
                    ▼             ▼
               fetch(1)       fetch(2)
                    │             │
                    ▼             ▼
                clearQItem(1)  clearQItem(2)
                    │             │
                    └──────┬──────┘
                           ▼
                    toast "Sincronización completa"
```

### 4.7 Service Worker avanzado (personalización)

Si necesitas comportamiento más específico que el que ofrece la configuración declarativa de Workbox, puedes usar el modo **injectManifest** en vez de la generación automática:

**`vite.config.ts`:**
```typescript
VitePWA({
  strategies: 'injectManifest',  // ← en vez de 'generateSW' (default)
  srcDir: 'src',
  filename: 'sw.ts',            // ← tu propio SW
});
```

**`src/sw.ts`:**
```typescript
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

// Precache all assets generated by the build
precacheAndRoute(self.__WB_MANIFEST);

// API routes: NetworkFirst
registerRoute(
  /\/api\/(productos|cajas|almacen)/i,
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
  })
);

// Images: StaleWhileRevalidate
registerRoute(
  /\/api\/productos\/\d+\/image/i,
  new StaleWhileRevalidate({
    cacheName: 'product-images',
  })
);

// Listen for skipWaiting message from the client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
```

> **Cuándo usar injectManifest:** Cuando necesitas lógica personalizada en el SW que no puede expresarse en la config declarativa (ej: limpiar cachés específicas, manejar push notifications, sincronización en background con Background Sync API).

---

## 📚 5. Referencia de Configuración

### Todas las opciones de `VitePWA` relevantes

```typescript
VitePWA({
  // ─── REGISTRATION ───
  registerType: 'prompt' | 'autoUpdate',

  // ─── STRATEGY ───
  strategies: 'generateSW' | 'injectManifest',

  // ─── MANIFEST ───
  manifest: {
    name: string,            // Nombre completo de la app
    short_name: string,      // Nombre corto (debajo del icono)
    description: string,     // Descripción
    theme_color: string,     // Color de la barra de estado
    background_color: string,// Color de splash screen
    display: 'standalone',   // fullscreen | standalone | minimal-ui | browser
    orientation: 'any',      // any | portrait | landscape
    start_url: string,       // '/' normalmente
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>,
  },

  // ─── WORKBOX (generateSW) ───
  workbox: {
    globPatterns: string[],  // Patrones de archivos a precachear
    globIgnores: string[],   // Patrones a ignorar
    cleanupOutdatedCaches: boolean, // true = limpia cachés viejas
    navigateFallback: string, // URL de fallback para navegación (ej: '/index.html')
    runtimeCaching: Array<{
      urlPattern: RegExp;
      handler: 'NetworkFirst' | 'CacheFirst' | 'StaleWhileRevalidate'
              | 'NetworkOnly' | 'CacheOnly';
      options: {
        cacheName: string;
        expiration: { maxEntries: number; maxAgeSeconds: number };
        networkTimeoutSeconds?: number;
        backgroundSync?: { name: string };
      };
    }>,
  },

  // ─── INJECT MANIFEST ───
  srcDir: string,    // Directorio donde está tu SW custom
  filename: string,  // Nombre del archivo SW
});
```

### Estrategias de handler de Workbox

| Handler | Cuándo usarlo | Ejemplo |
|---------|-------------|---------|
| `NetworkFirst` | La red es preferida pero aceptas datos viejos como respaldo. APIs que cambian frecuentemente. | Lista de productos, catálogos |
| `CacheFirst` | El recurso raramente cambia. Usa red solo si no está en caché. | Fonts, logos, librerías CDN |
| `StaleWhileRevalidate` | Sirve caché inmediatamente (rapidez), actualiza en background. Imágenes, assets no críticos. | Fotos de productos, avatares |
| `NetworkOnly` | Siempre red. No cachea. | Operaciones POST/PUT/DELETE |
| `CacheOnly` | Solo caché. No va a red. | Assets críticos offline-first |

---

## 🛡️ 6. Estrategias de Cacheo

### Recomendación por tipo de aplicación

| Tipo de app | API handler | Imágenes handler | Offline queue |
|---|---|---|---|
| Inventario / POS | `NetworkFirst` | `StaleWhileRevalidate` | ✅ Esencial |
| Dashboard / Analytics | `NetworkFirst` | `CacheFirst` | ❌ No necesario |
| Blog / Contenido | `CacheFirst` | `CacheFirst` | ❌ Opcional |
| Chat / Tiempo real | `NetworkOnly` | `StaleWhileRevalidate` | ✅ Recomendado |
| E-commerce | `NetworkFirst` | `StaleWhileRevalidate` | ✅ Carrito offline |

### TTL recomendados

| Recurso | TTL | Razón |
|---------|-----|-------|
| API catálogos | 24h | Los datos no cambian tan rápido |
| API inventario | 5min | Los conteos cambian constantemente |
| Imágenes producto | 30 días | Raramente cambian |
| Estáticos (JS/CSS) | forever | Cambian con nuevo SW |

### Limpieza de cachés

Workbox limpia automáticamente las cachés viejas cuando se instala un nuevo SW. Esto se controla con:

```typescript
workbox: {
  cleanupOutdatedCaches: true, // ← activado por defecto
}
```

Cuando el nuevo SW se activa, Workbox elimina todas las cachés que no coinciden con las definiciones actuales. Esto previene que la app acumule gigabytes de datos viejos.

---

## 🧪 7. Mejores Prácticas y Anti-Patrones

### ✅ Mejores prácticas

1. **Siempre usa `registerType: 'prompt'`** en producción. `autoUpdate` puede causar que el usuario pierda datos si está en medio de una operación cuando el SW se recarga.

2. **Monta `UpdateNotification` globalmente**, no dentro de rutas protegidas. El SW es global.

3. **Timeout de red en NetworkFirst**: Pon `networkTimeoutSeconds: 5`. Si la red tarda más, usa caché. Esto evita que la app se "cuelgue" en redes lentas.

4. **Cachea por separado APIs e imágenes**: Tienen diferentes TTL y patrones de uso. Mezclarlas en la misma caché hace difícil la limpieza.

5. **La offline queue debe ser FIFO estricto**: Las operaciones offline deben reenviarse en el mismo orden en que fueron creadas. Si una falla, detén la cola (no sigas con las siguientes).

6. **Muestra al usuario el estado de la cola offline**: Un badge o indicador visual en la UI que muestre "3 operaciones pendientes de sincronizar" mejora la transparencia.

7. **Prepara iconos en múltiples tamaños**: 192x192 y 512x512, con y sin `purpose: 'maskable'`. Android redondea los iconos maskable automáticamente.

### ❌ Anti-patrones

1. **❌ Hacer fetch de `/api/app-version` para detectar actualizaciones**: El SW ya detecta actualizaciones comparando hashes de archivos. No necesitas un endpoint de versión para eso.

2. **❌ Cachear POST/PUT/DELETE en el SW**: Las operaciones de escritura no deben cachearse. Usa `NetworkOnly` o mejor, no las incluyas en `runtimeCaching`.

3. **❌ Usar `CacheFirst` para APIs**: El usuario vería datos stale por días. Siempre prefiere `NetworkFirst` para datos dinámicos.

4. **❌ Ignorar el evento `controllerchange`**: Sin este listener, aunque el usuario haga clic en "Actualizar", la app no se recarga. El nuevo SW está instalado pero inactivo.

5. **❌ No limpiar `URL.createObjectURL`**: Si muestras previsualizaciones de imágenes (subidas por el usuario), libera las URLs creadas con `URL.revokeObjectURL()`. Las fugas de memoria en PWA son difíciles de depurar.

6. **❌ Asumir que `navigator.onLine` es confiable**: Es un booleano simple. No detecta pérdidas de paquetes ni redes lentas. Combínalo con `fetch` que falle por timeout.

7. **❌ Versionado manual de assets**: Workbox ya genera hashes únicos para cada archivo en el build (`index-abc123.js`). No necesitas agregar `?v=1.0.0` manualmente.

### 🔍 Debugging

```bash
# En Chrome DevTools:
# 1. Ve a Application > Service Workers
# 2. Verifica: "Received a new version of sw.js" cuando deployes
# 3. Usa "Update on reload" para desarrollo continuo de SW
# 4. Revisa Cache Storage > api-cache / product-images-cache

# En producción, agrega logging condicional:
const DEBUG_SW = import.meta.env.DEV;
if (DEBUG_SW) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('[SW MSG]', event.data);
  });
}
```

### Edge Cases conocidos

| Escenario | Comportamiento | Mitigación |
|-----------|---------------|-----------|
| Usuario offline cuando se detecta actualización | El toast se muestra, pero al hacer clic en "Actualizar" no pasa nada (no hay nuevo SW que activar) | El `setTimeout(1500)` de fallback forzará un reload; al reconectarse, el SW nuevo se activará |
| Múltiples pestañas abiertas | El nuevo SW solo se activa en la pestaña que hace clic en "Actualizar". Las otras siguen con el viejo. | Considera usar `clients.claim()` en el SW para reclamar todas las pestañas |
| Usuario ignora la actualización por semanas | La app funciona con el SW viejo. Los archivos estáticos viejos siguen en caché. | El SW nuevo se descarga en segundo plano pero no se activa hasta que el usuario acepte o recargue manualmente la página. |
| Almacenamiento lleno en el navegador | IndexedDB lanza error `QuotaExceededError` | La offline queue no debería crecer sin límite. Considera agregar un máximo de entradas (ej: 100) y rechazar nuevas si está llena. |

---

## 📦 Resumen de archivos del template

```
mi-proyecto/
├── vite.config.ts                              ← Configuración PWA + Workbox
├── src/
│   ├── App.tsx                                 ← <UpdateNotification /> global
│   ├── components/
│   │   └── UpdateNotification.tsx              ← Componente de notificación
│   └── utils/
│       └── pwaDb.ts                            ← IndexedDB + offline queue
└── public/
    └── icons/
        ├── icon-192.png                        ← Icono PWA 192x192
        └── icon-512.png                        ← Icono PWA 512x512
```

### Checklist de implementación

- [ ] 1. Instalar dependencias: `vite-plugin-pwa`, `idb`
- [ ] 2. Agregar iconos PWA en `/public/icons/`
- [ ] 3. Configurar `vite.config.ts` con `VitePWA`
- [ ] 4. Crear `UpdateNotification.tsx`
- [ ] 5. Agregar `<UpdateNotification />` en `App.tsx`
- [ ] 6. Crear `pwaDb.ts` (opcional: offline queue)
- [ ] 7. Construir y probar: `npm run build && npx serve dist`
- [ ] 8. Verificar en DevTools > Application > Service Workers
