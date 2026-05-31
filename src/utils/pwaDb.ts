import { openDB, IDBPDatabase } from "idb";
import { toast } from "sonner";

const DB_NAME = "inventario-pwa-db";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("catalogs");
        }
        if (oldVersion < 2) {
          db.createObjectStore("offline-queue", { keyPath: "id", autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Save catalog items in IndexedDB
 */
export async function saveCatalog(key: string, data: any[]) {
  try {
    const db = await getDB();
    await db.put("catalogs", data, key);
  } catch (err) {
    console.error(`Error al guardar catálogo ${key} en IndexedDB:`, err);
  }
}

/**
 * Load catalog items from IndexedDB
 */
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

/**
 * Helper to fetch a catalog with offline IndexedDB backup.
 */
export async function fetchCatalogWithCache(path: string, key: string): Promise<any[]> {
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
    const request: OfflineRequest = {
      url,
      method,
      body,
      timestamp: Date.now()
    };
    await db.add("offline-queue", request);
    window.dispatchEvent(new CustomEvent("pwa-offline-queue-changed"));
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
    window.dispatchEvent(new CustomEvent("pwa-offline-queue-changed"));
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
  const toastId = toast.loading(`Sincronizando ${queue.length} operación(es) pendiente(s)...`);

  let successCount = 0;
  for (const req of queue) {
    try {
      const resp = await fetch(req.url, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.body ? JSON.stringify(req.body) : undefined
      });
      if (resp.ok) {
        if (req.id !== undefined) {
          await clearQueueItem(req.id);
          successCount++;
        }
      } else {
        console.error("Error en respuesta al sincronizar:", await resp.text());
        break;
      }
    } catch (err) {
      console.error("Error de red durante sincronización offline:", err);
      break;
    }
  }

  isSyncing = false;
  toast.dismiss(toastId);

  if (successCount > 0) {
    toast.success(`¡Sincronización completa! ${successCount} operación(es) enviada(s) al servidor.`);
    window.dispatchEvent(new CustomEvent("pwa-sync-success"));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncOfflineQueue();
  });
}

/**
 * offlineFetch
 *
 * Wrapper for write operations (POST/PUT/DELETE) that handles network loss
 * by enqueuing the request locally.
 */
export async function offlineFetch(url: string, options: RequestInit): Promise<Response> {
  const method = options.method || "GET";
  
  if (method === "GET") {
    return fetch(url, options);
  }

  if (!navigator.onLine) {
    let bodyObj = null;
    if (options.body && typeof options.body === "string") {
      try { bodyObj = JSON.parse(options.body); } catch (_) {}
    }
    await enqueueRequest(url, method, bodyObj);
    toast.warning("Sin conexión. La operación fue guardada localmente y se sincronizará cuando recuperes internet.");
    
    return new Response(JSON.stringify({ success: true, offline: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const resp = await fetch(url, options);
    return resp;
  } catch (err) {
    let bodyObj = null;
    if (options.body && typeof options.body === "string") {
      try { bodyObj = JSON.parse(options.body); } catch (_) {}
    }
    await enqueueRequest(url, method, bodyObj);
    toast.warning("Error de red. La operación fue guardada localmente.");
    
    return new Response(JSON.stringify({ success: true, offline: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
}


