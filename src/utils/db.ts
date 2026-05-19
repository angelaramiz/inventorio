export interface CajaHistorial {
  id_caja: number;
  numero_caja: string;
  sku: string | null;
  estado: string;
  consultado_at: string;
  productos: {
    id_producto: number;
    cantidad: number;
    productos: {
      id_producto: number;
      sku: string;
      ean_13: string;
      talla: string;
      temporada: string;
      tipo: string;
      marca_sub: string;
      has_foto: boolean;
    };
  }[];
}

const DB_NAME = "inventorio_dashboard_db";
const STORE_NAME = "historial_cajas";
const DB_VERSION = 1;

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id_caja" });
      }
    };
  });
}

export async function saveBoxToHistory(caja: Omit<CajaHistorial, "consultado_at">): Promise<void> {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    
    const record: CajaHistorial = {
      ...caja,
      consultado_at: new Date().toISOString()
    };
    
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getHistory(): Promise<CajaHistorial[]> {
  const db = await initDB();
  return new Promise<CajaHistorial[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const result = request.result as CajaHistorial[];
      result.sort((a, b) => new Date(b.consultado_at).getTime() - new Date(a.consultado_at).getTime());
      resolve(result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearHistory(): Promise<void> {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
