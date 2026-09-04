import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import multer from "multer";
import { EventEmitter } from "events";
import fs from "fs";
import bcrypt from "bcryptjs";

// In-memory event emitter for real-time stock updates
const stockEvents = new EventEmitter();
stockEvents.setMaxListeners(100);

// Domain-level event bus — broadcasts inventory changes to all SSE clients
const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(200);

// Active SSE client count tracker
let activeSseClients = 0;

// In-memory transfer lock: prevents double-transfer of the same box
const transferLocks = new Set<number>();

// In-memory logs for manager notifications
const managerNotifications: any[] = [];

// In-memory image jobs map for background processing queue
const imageJobs = new Map<string, {
  taskId: string;
  productoId: number;
  progress: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}>();


// Load env vars based on NODE_ENV, fallback to loading .env if variables are missing
if (process.env.NODE_ENV !== 'production' || !process.env.SUPABASE_URL) {
  dotenv.config();
}

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS configuration for production
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // Reduced limit as images go through multipart
app.use(express.urlencoded({ extended: true })); // Mobile app sends FormBody (x-www-form-urlencoded)

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// --- IN-MEMORY RATE LIMITER FOR API PROTECTION ---
const ipRequestCounts = new Map<string, { count: number, resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 120; // Max 120 requests per minute

app.use("/api/", (req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] as string || req.ip || req.socket.remoteAddress || "unknown").split(',')[0].trim();
  const now = Date.now();
  const record = ipRequestCounts.get(ip);

  if (!record || now > record.resetTime) {
    ipRequestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  record.count++;
  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: "Demasiadas peticiones. Por favor intenta de nuevo en un minuto." });
  }

  next();
});

// --- INPUT SANITIZATION FUNCTION ---
// Restricts string to alphanumeric, hyphens, underscores, dots, colons, slashes, and spaces.
function sanitizeIdentifier(str: any, maxLength = 100): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9\-_.:/\s]/g, '').substring(0, maxLength).trim();
}

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Supabase Client (Lazy Load)
let supabaseClient: any = null;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_KEY environment variables");
    }
    supabaseClient = createClient(url, key);
  }
  return supabaseClient;
}

// Supabase con service_role (bypassa RLS) para conteos internos.
// Requiere SUPABASE_SERVICE_ROLE_KEY en entorno; si falta, usa anon + advierte.
let supabaseServiceClient: any = null;

function getSupabaseService() {
  if (!supabaseServiceClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error("Missing SUPABASE_URL or key environment variables");
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn("[WARN] SUPABASE_SERVICE_ROLE_KEY no configurado — usando anon key (RLS puede bloquear conteos internos)");
    }
    supabaseServiceClient = createClient(url, key);
  }
  return supabaseServiceClient;
}

// ─── OCR training job state (top-of-file, antes de rutas) ────────────
type JobState = {
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  verified_count: number;
  log_file: string | null;
  message: string | null;
};

const ocrTrainingJob: JobState = {
  status: "idle",
  started_at: null,
  finished_at: null,
  exit_code: null,
  verified_count: 0,
  log_file: null,
  message: null
};

// ─── Auth: requiere rol gerente/admin (JWT de Supabase) ───────────────
// BLOQUEANTE para deploy: ningún endpoint de training es público.
// El token Bearer se valida con Supabase Auth; el rol sale de
// app_metadata.rol (o user_metadata.rol) y debe ser gerente o admin.
async function requireManager(req: any, res: any, next: any) {
  try {
    const header: string = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      return res.status(401).json({ error: "No autorizado: falta token Bearer" });
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Token inválido o expirado" });
    }
    const rol = String(data.user.app_metadata?.rol || data.user.user_metadata?.rol || "").toLowerCase();
    if (rol !== "gerente" && rol !== "admin") {
      return res.status(403).json({ error: "Requiere rol gerente o admin" });
    }
    req.manager = { id: data.user.id, rol };
    next();
  } catch {
    return res.status(401).json({ error: "Fallo de autenticación" });
  }
}

let hasModeloGrupoColumn = false;
let hasFechaTemporadaColumn = false;
let hasCodigoColorColumn = false;
let schemaDetected = false;

async function detectSchema() {
  if (schemaDetected) return;
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from("productos").select("*").limit(1);
    if (data && data.length > 0) {
      hasModeloGrupoColumn = "modelo_grupo" in data[0];
      hasFechaTemporadaColumn = "fecha_temporada" in data[0];
      hasCodigoColorColumn = "codigo_color" in data[0];
    } else {
      const { error: error1 } = await supabase.from("productos").select("modelo_grupo").limit(1);
      hasModeloGrupoColumn = !error1;
      const { error: error2 } = await supabase.from("productos").select("fecha_temporada").limit(1);
      hasFechaTemporadaColumn = !error2;
      const { error: error3 } = await supabase.from("productos").select("codigo_color").limit(1);
      hasCodigoColorColumn = !error3;
    }
    schemaDetected = true;
    console.log("Schema detection: hasModeloGrupoColumn =", hasModeloGrupoColumn, ", hasFechaTemporadaColumn =", hasFechaTemporadaColumn, ", hasCodigoColorColumn =", hasCodigoColorColumn);
  } catch (err: any) {
    console.error("Error detecting schema:", err);
  }
}

function getProductFields() {
  return `id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at${hasModeloGrupoColumn ? ", modelo_grupo" : ""}${hasFechaTemporadaColumn ? ", fecha_temporada" : ""}${hasCodigoColorColumn ? ", codigo_color" : ""}`;
}

// --- HEALTH CHECK ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// --- VERSION CHECK ---
app.get('/api/app-version', (req, res) => {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    res.json({ version: pkg.version || '0.0.0' });
  } catch (error: any) {
    res.status(500).json({ error: 'No se pudo leer la versión de la aplicación' });
  }
});

// GET /api/android-version - Returns the latest Android app version (supports ?app=conteo, ?app=operations, ?app=loyalty)
app.get("/api/android-version", async (req, res) => {
  try {
    const app = req.query.app as string;
    const isConteo = app === "conteo";
    const isOperations = app === "operations";
    const isLoyalty = app === "loyalty";
    const key = isConteo ? "android_version_conteo" : isOperations ? "android_version_operations" : isLoyalty ? "android_version_loyalty" : "android_version";
    const defaultApk = isConteo ? "/public/inventorio-conteo.apk" : isOperations ? "/public/inventorio-operations.apk" : isLoyalty ? "/public/inventorio-loyalty.apk" : "/public/inventorio.apk";

    const supabase = getSupabase();
    const { data: settings, error } = await supabase
      .from("warehouse_settings")
      .select("valor")
      .eq("clave", key)
      .single();
      
    if (error && error.code !== 'PGRST116') throw error;
    
    const versionInfo = settings?.valor || {
      versionCode: 1,
      versionName: "1.0.0",
      apkUrl: defaultApk
    };
    
    res.json(versionInfo);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- API ROUTES ---

// GET /api/productos - EXCLUDING foto column for performance. Supports ?q, ?marca, ?talla, ?temporada, ?tipo filters
app.get("/api/productos", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { q, exactSku, marca, talla, temporada, tipo, modelo_grupo } = req.query as Record<string, string>;
    
    const fields = getProductFields();
    let query = supabase
      .from("productos")
      .select(fields)
      .order("created_at", { ascending: false });
    
    if (exactSku) {
      query = query.eq("sku", exactSku);
    }
    if (q) {
      // Search by SKU or EAN (partial match)
      query = query.or(`sku.ilike.%${q}%,ean_13.ilike.%${q}%,marca_sub.ilike.%${q}%`);
    }
    if (marca) {
      query = query.ilike("marca_sub", marca);
    }
    if (talla) {
      query = query.ilike("talla", talla);
    }
    if (temporada) {
      query = query.ilike("temporada", temporada);
    }
    if (tipo) {
      query = query.ilike("tipo", tipo);
    }
    if (hasModeloGrupoColumn && modelo_grupo) {
      query = query.eq("modelo_grupo", modelo_grupo);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    const mappedData = (data || []).map(p => ({
      modelo_grupo: "sin modelo",
      ...p
    }));
    
    res.json(mappedData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos - Supporting multipart/form-data for binary capture
app.post("/api/productos", upload.single('foto'), async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    let { sku, ean_13, talla, temporada, tipo, marca_sub, modelo_grupo, fecha_temporada, codigo_color } = req.body;
    
    sku = sanitizeIdentifier(sku, 100);
    if (!sku) {
      return res.status(400).json({ error: "El SKU es obligatorio y debe ser válido" });
    }
    
    if (ean_13) {
      ean_13 = sanitizeIdentifier(ean_13, 13);
      if (ean_13 && !/^\d+$/.test(ean_13)) {
        return res.status(400).json({ error: "El EAN-13 debe contener solo dígitos" });
      }
    } else {
      ean_13 = null;
    }
    
    talla = sanitizeIdentifier(talla, 50);
    temporada = (sanitizeIdentifier(temporada, 100) || "todouso").toLowerCase();
    tipo = (sanitizeIdentifier(tipo, 100) || "otro").toLowerCase();
    marca_sub = sanitizeIdentifier(marca_sub, 100);
    
    const insertData: any = { sku, ean_13, talla, temporada, tipo, marca_sub };
    if (req.file) {
      insertData.foto = '\\x' + req.file.buffer.toString('hex');
    }
    if (hasModeloGrupoColumn) {
      insertData.modelo_grupo = sanitizeIdentifier(modelo_grupo, 100) || "sin modelo";
    }
    if (hasFechaTemporadaColumn && fecha_temporada) {
      insertData.fecha_temporada = sanitizeIdentifier(fecha_temporada, 50);
    }
    if (hasCodigoColorColumn && codigo_color) {
      insertData.codigo_color = sanitizeIdentifier(codigo_color, 50);
    }
    
    const fields = getProductFields();
    const { data, error } = await supabase
      .from("productos")
      .insert([insertData])
      .select(fields);
    
    if (error) throw error;
    
    const result = {
      modelo_grupo: "sin modelo",
      ...data[0]
    };
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/productos/:id/image - Dedicated binary image server with caching
app.get("/api/productos/:id/image", async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabase();
    
    // Fetch only the foto column
    const { data, error } = await supabase
      .from("productos")
      .select("foto")
      .eq("id_producto", id)
      .single();
    
    if (error || !data || !data.foto) {
      return res.status(404).end();
    }

    // data.foto can come as a hex string starting with \x from PostgREST or base64
    let buffer: Buffer;
    if (typeof data.foto === 'string') {
      if (data.foto.startsWith('\\x')) {
        const rawBuffer = Buffer.from(data.foto.substring(2), 'hex');
        const rawString = rawBuffer.toString('utf8');
        if (rawString.startsWith('{"type":"Buffer"') || rawString.startsWith('{"type":"Buffer","data"')) {
          try {
            const parsed = JSON.parse(rawString);
            if (parsed && parsed.type === 'Buffer' && Array.isArray(parsed.data)) {
              buffer = Buffer.from(parsed.data);
            } else {
              buffer = rawBuffer;
            }
          } catch (e) {
            buffer = rawBuffer;
          }
        } else {
          buffer = rawBuffer;
        }
      } else {
        buffer = Buffer.from(data.foto, 'base64');
      }
    } else if (Buffer.isBuffer(data.foto)) {
      buffer = data.foto;
    } else {
      buffer = Buffer.from(data.foto as any);
    }
    
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `W/"${id}-${buffer.length}"`);
    
    res.send(buffer);
  } catch (error: any) {
    res.status(500).end();
  }
});

// GET /api/cajas
app.get("/api/cajas", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { temporada_default } = req.query as Record<string, string>;
    
    let query = supabase
      .from("vista_total_cajas")
      .select("*")
      .order("fecha_creacion", { ascending: false });
    
    if (temporada_default) {
      query = query.ilike("temporada_default", temporada_default);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cajas/suggested-prefixes - Auto-discover prefix patterns
app.get("/api/cajas/suggested-prefixes", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: boxes, error } = await supabase
      .from("cajas")
      .select("numero_caja");
      
    if (error) throw error;
    
    const counts: Record<string, number> = {};
    if (boxes) {
      for (const box of boxes) {
        if (!box.numero_caja) continue;
        const match = box.numero_caja.match(/^([a-zA-Z-]+)(\d+)$/);
        if (match) {
          const prefix = match[1].toUpperCase();
          counts[prefix] = (counts[prefix] || 0) + 1;
        }
      }
    }
    
    const suggested = Object.entries(counts)
      .filter(([prefix, count]) => count >= 3)
      .map(([prefix, count]) => prefix)
      .sort();
      
    const standardPrefixes = ["CJ-", "CJ-PL-", "CJ-PF-", "CJ-PR-"];
    for (const p of standardPrefixes) {
      if (!suggested.includes(p)) suggested.push(p);
    }

    const responseFormat = suggested.map(prefix => {
       if (prefix === "CJ-") return { id: "CJ-X", base: "CJ-", label: "CJ-X (Caja Normal)" };
       if (prefix === "CJ-PL-") return { id: "CJ-PLX", base: "CJ-PL-", label: "CJ-PLX (Caja Plana/PL)" };
       if (prefix === "CJ-PF-") return { id: "CJ-PFX", base: "CJ-PF-", label: "CJ-PFX (Caja Perfume/PF)" };
       if (prefix === "CJ-PR-") return { id: "CJ-PRX", base: "CJ-PR-", label: "CJ-PRX (Caja Prenda/PR)" };
       
       const cleanBase = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
       return { id: `${cleanBase}-X`, base: prefix, label: `${cleanBase}-X (Auto-detectado)` };
    });
    
    res.json(responseFormat);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cajas/next-number - Fetch next sequential sequence number for standard prefixes
app.get("/api/cajas/next-number", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { prefix } = req.query as Record<string, string>;
    if (!prefix) {
      return res.status(400).json({ error: "El prefijo es requerido" });
    }
    
    const { data: boxes, error } = await supabase
      .from("cajas")
      .select("numero_caja, sku")
      .or(`numero_caja.ilike.${prefix}%,sku.ilike.${prefix}%`);
      
    if (error) throw error;
    
    let maxNum = 0;
    const escapedPrefix = prefix.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const regex = new RegExp(`${escapedPrefix}(\\d+)`, 'i');
    
    if (boxes && boxes.length > 0) {
      for (const box of boxes) {
        const matchName = box.numero_caja ? box.numero_caja.match(regex) : null;
        if (matchName) {
          const num = parseInt(matchName[1], 10);
          if (num > maxNum) maxNum = num;
        }
        const matchSku = box.sku ? box.sku.match(regex) : null;
        if (matchSku) {
          const num = parseInt(matchSku[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }
    
    res.json({ nextNumber: maxNum + 1 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cajas
app.post("/api/cajas", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { numero_caja, sku, id_zona_seccion, id_zona_almacen, id_zona_nivel, temporada_default, tags } = req.body;
    
    numero_caja = sanitizeIdentifier(numero_caja, 50);
    if (!numero_caja) {
      return res.status(400).json({ error: "El número de caja es requerido y debe ser válido" });
    }
    
    const insertData: any = { numero_caja, estado: 'vacia' };
    if (sku !== undefined && sku !== null) {
      const cleanSku = sanitizeIdentifier(sku, 100);
      insertData.sku = cleanSku === "" ? null : cleanSku;
    }
    if (id_zona_nivel !== undefined && id_zona_nivel !== null && id_zona_nivel !== "") {
      const parsedLvl = parseInt(id_zona_nivel);
      if (isNaN(parsedLvl) || parsedLvl <= 0) {
        return res.status(400).json({ error: "ID de nivel inválido" });
      }
      insertData.id_zona_nivel = parsedLvl;
      insertData.id_zona_seccion = null;
      insertData.id_zona_almacen = null;
    } else if (id_zona_seccion !== undefined && id_zona_seccion !== null && id_zona_seccion !== "") {
      const parsedSec = parseInt(id_zona_seccion);
      if (isNaN(parsedSec) || parsedSec <= 0) {
        return res.status(400).json({ error: "ID de sección inválido" });
      }
      insertData.id_zona_seccion = parsedSec;
      insertData.id_zona_almacen = null;
      insertData.id_zona_nivel = null;
    } else if (id_zona_almacen !== undefined && id_zona_almacen !== null && id_zona_almacen !== "") {
      const parsedAlm = parseInt(id_zona_almacen);
      if (isNaN(parsedAlm) || parsedAlm <= 0) {
        return res.status(400).json({ error: "ID de almacén inválido" });
      }
      insertData.id_zona_almacen = parsedAlm;
      insertData.id_zona_seccion = null;
      insertData.id_zona_nivel = null;
    }
 
    // Optional: set default season for products added to this box
    if (temporada_default && temporada_default.trim()) {
      insertData.temporada_default = sanitizeIdentifier(temporada_default, 100).toLowerCase();
    }
    
    insertData.tags = tags || { tipo_producto: "todos", genero: "todos", marca: "todos" };
    
    const { data, error } = await supabase
      .from("cajas")
      .insert([insertData])
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
 
// PUT /api/cajas/:id
app.put("/api/cajas/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de caja inválido" });
    }
    const { estado, sku, id_zona_seccion, id_zona_almacen, id_zona_nivel, temporada_default, tags } = req.body;
    
    const updateData: any = {};
    if (estado !== undefined) {
      if (!['vacia', 'activa', 'llena'].includes(estado)) {
        return res.status(400).json({ error: "Estado de caja inválido" });
      }
      updateData.estado = estado;
    }
    if (sku !== undefined) {
      const cleanSku = sanitizeIdentifier(sku, 100);
      updateData.sku = cleanSku === "" ? null : cleanSku;
    }

    if (temporada_default !== undefined) {
      if (temporada_default === null || temporada_default === "") {
        updateData.temporada_default = null;
      } else {
        updateData.temporada_default = sanitizeIdentifier(temporada_default, 100).toLowerCase();
      }
    }
    if (tags !== undefined) {
      updateData.tags = tags;
      
      // Propagate specific clothing type or calzado type to products inside the container
      if (tags.tipo_producto_exacto && tags.tipo_producto_exacto !== "todos") {
        try {
          const { data: boxProds, error: bpErr } = await supabase
            .from("caja_productos")
            .select("id_producto")
            .eq("id_caja", id);
          
          if (!bpErr && boxProds && boxProds.length > 0) {
            const productIds = boxProds.map((bp: any) => bp.id_producto);
            await supabase
              .from("productos")
              .update({ tipo: tags.tipo_producto_exacto })
              .in("id_producto", productIds);
          }
        } catch (err: any) {
          console.error("Error inheriting tipo_producto_exacto:", err.message);
        }
      } else if (tags.tipo_producto === "calzado") {
        try {
          const { data: boxProds, error: bpErr } = await supabase
            .from("caja_productos")
            .select("id_producto")
            .eq("id_caja", id);
          
          if (!bpErr && boxProds && boxProds.length > 0) {
            const productIds = boxProds.map((bp: any) => bp.id_producto);
            await supabase
              .from("productos")
              .update({ tipo: "calzado" })
              .in("id_producto", productIds);
          }
        } catch (err: any) {
          console.error("Error inheriting calzado type:", err.message);
        }
      }
    }
    if (id_zona_nivel !== undefined) {
      if (id_zona_nivel === null || id_zona_nivel === "") {
        updateData.id_zona_nivel = null;
      } else {
        const parsedLvl = parseInt(id_zona_nivel);
        if (isNaN(parsedLvl) || parsedLvl <= 0) {
          return res.status(400).json({ error: "ID de nivel inválido" });
        }
        updateData.id_zona_nivel = parsedLvl;
        updateData.id_zona_seccion = null;
        updateData.id_zona_almacen = null;
      }
    } else if (id_zona_seccion !== undefined && id_zona_seccion !== null && id_zona_seccion !== "") {
      const parsedSec = parseInt(id_zona_seccion);
      if (isNaN(parsedSec) || parsedSec <= 0) {
        return res.status(400).json({ error: "ID de sección inválido" });
      }
      updateData.id_zona_seccion = parsedSec;
      updateData.id_zona_almacen = null;
      updateData.id_zona_nivel = null;
    } else if (id_zona_almacen !== undefined && id_zona_almacen !== null && id_zona_almacen !== "") {
      const parsedAlm = parseInt(id_zona_almacen);
      if (isNaN(parsedAlm) || parsedAlm <= 0) {
        return res.status(400).json({ error: "ID de almacén inválido" });
      }
      updateData.id_zona_almacen = parsedAlm;
      updateData.id_zona_seccion = null;
      updateData.id_zona_nivel = null;
    } else if (id_zona_seccion === null || id_zona_almacen === null || id_zona_nivel === null) {
      updateData.id_zona_seccion = null;
      updateData.id_zona_almacen = null;
      updateData.id_zona_nivel = null;
    }
    
    const { data, error } = await supabase
      .from("cajas")
      .update(updateData)
      .eq("id_caja", id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/cajas/:id
app.delete("/api/cajas/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de caja inválido" });
    }
    
    const { data, error } = await supabase
      .from("cajas")
      .delete()
      .eq("id_caja", id)
      .select();
      
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: "La caja no existe" });
    }

    emitDomainEvent("caja:updated", {
      action: "eliminar",
      id_caja: id
    });

    res.json({ success: true, message: "Caja eliminada correctamente", deleted: data[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/verificar/:ean
app.get("/api/verificar/:ean", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { ean } = req.params;
    
    const fields = getProductFields();
    
    // Layered search to find the product
    let foundProduct = null;

    // 1. Exact case-insensitive match on sku or ean_13
    const { data: exactMatch, error: exactError } = await supabase
      .from("productos")
      .select(fields)
      .or(`ean_13.ilike.${ean},sku.ilike.${ean}`)
      .limit(1);

    if (exactError) throw exactError;

    if (exactMatch && exactMatch.length > 0) {
      foundProduct = exactMatch[0];
    }

    // 2. Partial match on sku or ean_13 or exact match on modelo_grupo
    if (!foundProduct) {
      let orFilter = `ean_13.ilike.%${ean}%,sku.ilike.%${ean}%`;
      if (hasModeloGrupoColumn) {
        orFilter += `,modelo_grupo.ilike.${ean}`;
      }
      const { data: partialMatch, error: partialError } = await supabase
        .from("productos")
        .select(fields)
        .or(orFilter)
        .limit(1);

      if (partialError) throw partialError;

      if (partialMatch && partialMatch.length > 0) {
        foundProduct = partialMatch[0];
      }
    }

    // 3. Partial match on modelo_grupo
    if (!foundProduct && hasModeloGrupoColumn) {
      const { data: modelMatch, error: modelError } = await supabase
        .from("productos")
        .select(fields)
        .ilike("modelo_grupo", `%${ean}%`)
        .limit(1);

      if (modelError) throw modelError;

      if (modelMatch && modelMatch.length > 0) {
        foundProduct = modelMatch[0];
      }
    }

    if (!foundProduct) {
      return res.json({ exists: false });
    }
    
    const mappedProduct = {
      modelo_grupo: "sin modelo",
      ...foundProduct
    };
    
    // 2. Buscar si esta en alguna caja activa o llena
    const { data: ubicaciones, error: uError } = await supabase
      .from("caja_productos")
      .select(`
        id_caja,
        cantidad,
        cajas (
          numero_caja,
          estado
        )
      `)
      .eq("id_producto", foundProduct.id_producto);
    
    if (uError) throw uError;
    
    const ubicacionActiva = ubicaciones?.find((u: any) => u.cajas.estado !== 'vacia');
    
    res.json({
      exists: true,
      product: mappedProduct,
      ubicacion: ubicacionActiva ? {
        numero_caja: ubicacionActiva.cajas.numero_caja,
        estado: ubicacionActiva.cajas.estado,
        cantidad: ubicacionActiva.cantidad
      } : null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cajas/:id/asignar
app.post("/api/cajas/:id/asignar", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id: id_caja } = req.params;
    const { id_producto, cantidad = 1, force = false, accion = 'agregar' } = req.body;
    
    // 1. Verificar si el producto ya esta en OTRA caja activa/llena
    if (!force) {
      const { data: existing, error: eError } = await supabase
        .from("caja_productos")
        .select("id_caja, cajas(estado, numero_caja)")
        .eq("id_producto", id_producto);
      
      if (eError) throw eError;
      
      const conflicto = existing?.find((e: any) => e.id_caja != id_caja && e.cajas.estado !== 'vacia');
      if (conflicto) {
        return res.status(409).json({
          error: "Producto ya asignado",
          ubicacion: conflicto.cajas.numero_caja,
          estado: conflicto.cajas.estado
        });
      }
    } else {
      if (accion === 'mover') {
        const { data: existing, error: eError } = await supabase
          .from("caja_productos")
          .select("id_caja, cajas(estado)")
          .eq("id_producto", id_producto);
        
        if (eError) throw eError;
        
        const conflicto = existing?.find((e: any) => e.id_caja != id_caja && e.cajas.estado !== 'vacia');
        if (conflicto) {
          const { error: delError } = await supabase
            .from("caja_productos")
            .delete()
            .eq("id_producto", id_producto)
            .eq("id_caja", conflicto.id_caja);
            
          if (delError) throw delError;
          
          // Actualizar estado de la caja origen si quedo vacia
          const { data: remaining } = await supabase
            .from("caja_productos")
            .select("cantidad")
            .eq("id_caja", conflicto.id_caja);
            
          if (!remaining || remaining.length === 0) {
            await supabase.from("cajas").update({ estado: 'vacia' }).eq("id_caja", conflicto.id_caja);
          }

          // Emit old box updated (mover original box has been cleared of this product)
          emitDomainEvent("caja:updated", {
            action: "desasignar",
            id_caja: conflicto.id_caja,
            id_producto: parseInt(id_producto)
          });
        }
      }
    }
    
    // 2. Asignar (Upsert - acumulando cantidad)
    const { data: existingInBox, error: eBoxError } = await supabase
      .from("caja_productos")
      .select("cantidad")
      .eq("id_caja", id_caja)
      .eq("id_producto", id_producto)
      .maybeSingle();

    if (eBoxError) throw eBoxError;

    const finalCantidad = existingInBox ? (existingInBox.cantidad + cantidad) : cantidad;

    const { error: aError } = await supabase
      .from("caja_productos")
      .upsert({ id_caja, id_producto, cantidad: finalCantidad }, { onConflict: 'id_caja,id_producto' });
    
    if (aError) throw aError;
    
    // 3. Actualizar estado de la caja si era vacia
    const { data: caja } = await supabase.from("cajas").select("estado").eq("id_caja", id_caja).single();
    if (caja?.estado === 'vacia') {
      await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", id_caja);
    }
    
    // Emit target box updated
    emitDomainEvent("caja:updated", {
      action: "asignar",
      id_caja: parseInt(id_caja),
      id_producto: parseInt(id_producto),
      cantidad: finalCantidad
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cajas/:id/productos
app.get("/api/cajas/:id/productos", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { id } = req.params;
    
    let productoFields = "id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at";
    if (hasModeloGrupoColumn) productoFields += ", modelo_grupo";
    if (hasCodigoColorColumn) productoFields += ", codigo_color";
    
    const { data, error } = await supabase
      .from("caja_productos")
      .select(`
        id_producto,
        cantidad,
        productos (${productoFields})
      `)
      .eq("id_caja", id);
    
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/cajas/:id/productos/:id_producto - Update product quantity in box
app.put("/api/cajas/:id/productos/:id_producto", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id_caja = parseInt(req.params.id);
    const id_producto = parseInt(req.params.id_producto);
    const { cantidad } = req.body;
    
    if (isNaN(id_caja) || id_caja <= 0 || isNaN(id_producto) || id_producto <= 0) {
      return res.status(400).json({ error: "IDs inválidos" });
    }
    
    const parsedCantidad = parseInt(cantidad);
    if (isNaN(parsedCantidad) || parsedCantidad < 0) {
      return res.status(400).json({ error: "Cantidad inválida" });
    }
    
    if (parsedCantidad === 0) {
      // Delete the product relation from the box
      const { error: delErr } = await supabase
        .from("caja_productos")
        .delete()
        .eq("id_caja", id_caja)
        .eq("id_producto", id_producto);
      if (delErr) throw delErr;
      
      // Update box state to vacia if there are no more products
      const { data: remaining } = await supabase
        .from("caja_productos")
        .select("cantidad")
        .eq("id_caja", id_caja);
        
      if (!remaining || remaining.length === 0) {
        await supabase.from("cajas").update({ estado: 'vacia' }).eq("id_caja", id_caja);
      }

      emitDomainEvent("caja:updated", {
        action: "desasignar",
        id_caja: id_caja,
        id_producto: id_producto
      });
    } else {
      // Update the quantity
      const { error: updErr } = await supabase
        .from("caja_productos")
        .update({ cantidad: parsedCantidad })
        .eq("id_caja", id_caja)
        .eq("id_producto", id_producto);
      if (updErr) throw updErr;
      
      // Update box state to activa if it was vacia
      const { data: caja } = await supabase.from("cajas").select("estado").eq("id_caja", id_caja).single();
      if (caja?.estado === 'vacia') {
        await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", id_caja);
      }

      emitDomainEvent("caja:updated", {
        action: "actualizar-cantidad",
        id_caja: id_caja,
        id_producto: id_producto,
        cantidad: parsedCantidad
      });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/reporte-inventario - Fetch all box-product relations for reporting
app.get("/api/reporte-inventario", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from("caja_productos")
      .select(`
        id_caja,
        id_producto,
        cantidad,
        cajas (
          id_caja,
          numero_caja,
          sku,
          estado,
          id_zona_seccion,
          id_zona_almacen
        ),
        productos (
          id_producto,
          sku,
          ean_13,
          talla,
          temporada,
          tipo,
          marca_sub
        )
      `);
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/productos/group-edit - Group edit products by their modelo_grupo
app.put("/api/productos/group-edit", upload.single('foto'), async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    let { modelo_grupo_origen, temporada, tipo, marca_sub, modelo_grupo_nuevo, delete_foto } = req.body;
    
    if (!hasModeloGrupoColumn) {
      return res.status(400).json({ error: "La base de datos no soporta columnas de modelo de grupo" });
    }

    if (!modelo_grupo_origen || modelo_grupo_origen === "sin modelo") {
      return res.status(400).json({ error: "Debe proveer un modelo de grupo de origen válido" });
    }

    const updateData: any = {};
    if (temporada !== undefined && temporada !== "") {
      updateData.temporada = (sanitizeIdentifier(temporada, 100) || "todouso").toLowerCase();
    }
    if (tipo !== undefined && tipo !== "") {
      updateData.tipo = (sanitizeIdentifier(tipo, 100) || "otro").toLowerCase();
    }
    if (marca_sub !== undefined && marca_sub !== "") {
      updateData.marca_sub = sanitizeIdentifier(marca_sub, 100);
    }
    if (modelo_grupo_nuevo !== undefined && modelo_grupo_nuevo !== "") {
      updateData.modelo_grupo = sanitizeIdentifier(modelo_grupo_nuevo, 100) || "sin modelo";
    }

    if (req.file) {
      updateData.foto = '\\x' + req.file.buffer.toString('hex');
    } else if (delete_foto === 'true') {
      updateData.foto = null;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No se proporcionaron campos válidos para actualizar" });
    }

    const { data, error } = await supabase
      .from("productos")
      .update(updateData)
      .eq("modelo_grupo", modelo_grupo_origen)
      .select("id_producto");

    if (error) throw error;
    
    res.json({ success: true, count: data ? data.length : 0 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/bulk-save - Save multiple products at once (SKU, EAN-13, Talla)
app.post("/api/productos/bulk-save", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { products } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Parámetro 'products' inválido" });
    }

    for (const p of products) {
      const { id_producto, sku, ean_13, talla } = p;
      if (!id_producto || !sku) continue;

      const updateData: any = {
        sku: sanitizeIdentifier(sku, 100),
        talla: sanitizeIdentifier(talla, 50)
      };
      
      if (ean_13 !== undefined) {
        if (ean_13) {
          const cleanEan = sanitizeIdentifier(ean_13, 13);
          updateData.ean_13 = cleanEan;
        } else {
          updateData.ean_13 = null;
        }
      }

      await supabase
        .from("productos")
        .update(updateData)
        .eq("id_producto", id_producto);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/bulk-csv - Register products imported from CSV
app.post("/api/productos/bulk-csv", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    let { products, id_caja, id_zona_nivel, id_zona_seccion, id_zona_almacen } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "No se proporcionaron productos para importar" });
    }

    // Sanitize and validate rows
    const sanitizedProducts: any[] = [];
    const skusToCheck: string[] = [];

    for (const p of products) {
      const sku = sanitizeIdentifier(p.sku || p.upc || p.ean_13 || p.codigo, 100);
      if (!sku) continue; // Skip rows without SKU

      const ean_13 = sanitizeIdentifier(p.ean_13 || p.ean || sku, 13);
      const talla = sanitizeIdentifier(p.talla || p.size || "SinTalla", 50);
      let baseModel = sanitizeIdentifier(p.modelo || p.modelo_grupo || p.grupo || "sin modelo", 100);
      let color = sanitizeIdentifier(p.color || p.codigo_color || p.colour || "", 50);
      
      if (baseModel.includes("-") && !color) {
        const parts = baseModel.split("-");
        baseModel = parts[0];
        color = parts[parts.length - 1]; // Use last part as color code
      }

      const fecha_temporada = sanitizeIdentifier(p.fecha_temporada || p.season_date || "", 50);
      const marca_sub = sanitizeIdentifier(p.marca || p.marca_sub || p.brand || "Guess", 100);
      const tipo = (sanitizeIdentifier(p.tipo || p.prenda || p.categoria || "otro", 100) || "otro").toLowerCase();
      const temporada = (sanitizeIdentifier(p.temporada || p.season || "todouso", 100) || "todouso").toLowerCase();
      const cantidad = parseInt(p.cantidad || p.qty || p.stock) || 0;

      sanitizedProducts.push({
        sku,
        ean_13,
        talla,
        modelo_grupo: baseModel,
        codigo_color: color,
        fecha_temporada,
        marca_sub,
        tipo,
        temporada,
        cantidad
      });

      skusToCheck.push(sku);
    }

    if (sanitizedProducts.length === 0) {
      return res.status(400).json({ error: "No hay productos válidos con SKU en el lote" });
    }

    const fields = getProductFields();

    // Fetch existing products to avoid duplicate inserts
    const { data: existingProds, error: fetchErr } = await supabase
      .from("productos")
      .select(fields)
      .in("sku", skusToCheck);

    if (fetchErr) throw fetchErr;

    const existingSkuMap = new Map<string, any>();
    if (existingProds) {
      existingProds.forEach((p: any) => {
        existingSkuMap.set(p.sku.toLowerCase(), p);
      });
    }

    const newProductInserts: any[] = [];
    const alreadyExistingProds: any[] = [];

    for (const p of sanitizedProducts) {
      const existing = existingSkuMap.get(p.sku.toLowerCase());
      if (existing) {
        alreadyExistingProds.push(existing);
      } else {
        const insertData: any = {
          sku: p.sku,
          ean_13: p.ean_13,
          talla: p.talla,
          temporada: p.temporada,
          tipo: p.tipo,
          marca_sub: p.marca_sub
        };
        if (hasModeloGrupoColumn) {
          insertData.modelo_grupo = p.modelo_grupo;
        }
        if (hasFechaTemporadaColumn && p.fecha_temporada) {
          insertData.fecha_temporada = p.fecha_temporada;
        }
        if (hasCodigoColorColumn && p.codigo_color) {
          insertData.codigo_color = p.codigo_color;
        }
        newProductInserts.push(insertData);
      }
    }

    let createdProducts: any[] = [];

    if (newProductInserts.length > 0) {
      const { data, error: pErr } = await supabase
        .from("productos")
        .insert(newProductInserts)
        .select(fields);
        
      if (pErr) throw pErr;
      if (data) createdProducts = data;
    }

    const allProducts = [...createdProducts, ...alreadyExistingProds];
    const allProductsMap = new Map<string, any>();
    allProducts.forEach(p => allProductsMap.set(p.sku.toLowerCase(), p));

    // Resolve destination container targetCajaId
    let targetCajaId = id_caja ? parseInt(id_caja) : null;
    
    if (!targetCajaId) {
      if (id_zona_nivel) {
        const lvlId = parseInt(id_zona_nivel);
        if (!isNaN(lvlId)) {
          const { data: lvlObj } = await supabase.from("zonas_nivel").select("nombre, id_zona_seccion").eq("id_zona_nivel", lvlId).maybeSingle();
          if (lvlObj) {
            const nameToMatch = `NIVEL: ${lvlObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_nivel", lvlId)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_nivel: lvlId,
                  id_zona_seccion: lvlObj.id_zona_seccion,
                  estado: 'vacia',
                  tags: { tipo_producto: "ropa", genero: "todos", marca: "Guess" }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      } else if (id_zona_seccion) {
        const secId = parseInt(id_zona_seccion);
        if (!isNaN(secId)) {
          const { data: secObj } = await supabase.from("zonas_seccion").select("nombre").eq("id_zona_seccion", secId).maybeSingle();
          if (secObj) {
            const nameToMatch = `SECCIÓN: ${secObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_seccion", secId)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_seccion: secId,
                  estado: 'vacia',
                  tags: { tipo_producto: "ropa", genero: "todos", marca: "Guess" }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      } else if (id_zona_almacen) {
        const almId = parseInt(id_zona_almacen);
        if (!isNaN(almId)) {
          const { data: almObj } = await supabase.from("zonas_almacen").select("nombre").eq("id_zona_almacen", almId).maybeSingle();
          if (almObj) {
            const nameToMatch = `ALMACÉN: ${almObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_almacen", almId)
              .is("id_zona_seccion", null)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_almacen: almId,
                  estado: 'vacia',
                  tags: { tipo_producto: "ropa", genero: "todos", marca: "Guess" }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      }
    }

    // Associate to container if resolved AND product has cantidad > 0
    if (targetCajaId) {
      const associations: any[] = [];
      for (const p of sanitizedProducts) {
        if (p.cantidad > 0) {
          const matchedProd = allProductsMap.get(p.sku.toLowerCase());
          if (matchedProd) {
            associations.push({
              id_caja: targetCajaId,
              id_producto: matchedProd.id_producto,
              cantidad: p.cantidad
            });
          }
        }
      }

      if (associations.length > 0) {
        const { error: assocErr } = await supabase
          .from("caja_productos")
          .upsert(associations, { onConflict: "id_caja,id_producto" });
          
        if (assocErr) throw assocErr;
        
        await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", targetCajaId).eq("estado", "vacia");
      }
    }

    res.json({ success: true, count: allProducts.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/productos/:id - Editing product info and/or photo
app.put("/api/productos/:id", upload.single('foto'), async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }
    let { sku, ean_13, talla, temporada, tipo, marca_sub, delete_foto, modelo_grupo, fecha_temporada, codigo_color } = req.body;
    
    const updateData: any = {};
    if (sku !== undefined) {
      sku = sanitizeIdentifier(sku, 100);
      if (!sku) return res.status(400).json({ error: "El SKU es obligatorio y debe ser válido" });
      updateData.sku = sku;
    }
    if (ean_13 !== undefined) {
      if (ean_13) {
        ean_13 = sanitizeIdentifier(ean_13, 13);
        if (ean_13 && !/^\d+$/.test(ean_13)) {
          return res.status(400).json({ error: "El EAN-13 debe contener solo dígitos" });
        }
        updateData.ean_13 = ean_13;
      } else {
        updateData.ean_13 = null;
      }
    }
    if (talla !== undefined) updateData.talla = sanitizeIdentifier(talla, 50);
    if (temporada !== undefined) updateData.temporada = (sanitizeIdentifier(temporada, 100) || "todouso").toLowerCase();
    if (tipo !== undefined) updateData.tipo = (sanitizeIdentifier(tipo, 100) || "otro").toLowerCase();
    if (marca_sub !== undefined) updateData.marca_sub = sanitizeIdentifier(marca_sub, 100);
    
    if (hasModeloGrupoColumn && modelo_grupo !== undefined) {
      updateData.modelo_grupo = sanitizeIdentifier(modelo_grupo, 100) || "sin modelo";
    }
    if (hasFechaTemporadaColumn && fecha_temporada !== undefined) {
      updateData.fecha_temporada = sanitizeIdentifier(fecha_temporada, 50);
    }
    if (hasCodigoColorColumn && codigo_color !== undefined) {
      updateData.codigo_color = sanitizeIdentifier(codigo_color, 50);
    }
    
    if (req.file) {
      updateData.foto = '\\x' + req.file.buffer.toString('hex');
    } else if (delete_foto === 'true') {
      updateData.foto = null;
    }
    
    const fields = getProductFields();
    const { data, error } = await supabase
      .from("productos")
      .update(updateData)
      .eq("id_producto", id)
      .select(fields);
      
    if (error) throw error;
    
    const result = {
      modelo_grupo: "sin modelo",
      ...data[0]
    };
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/productos/:id - Deleting product
app.delete("/api/productos/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }

    // Fetch SKU before delete so we can broadcast it
    const { data: prodData } = await supabase
      .from("productos")
      .select("sku, ean_13")
      .eq("id_producto", id)
      .maybeSingle();

    const { error } = await supabase
      .from("productos")
      .delete()
      .eq("id_producto", id);
      
    if (error) throw error;

    // Broadcast deletion so scanners on other devices can react
    emitDomainEvent("producto:deleted", {
      id_producto: id,
      sku: prodData?.sku || null,
      ean_13: prodData?.ean_13 || null,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/productos/normalize-preview - Preview products with compound modelo_grupo that need splitting
app.get("/api/productos/normalize-preview", async (req, res) => {
  try {
    await detectSchema();
    if (!hasModeloGrupoColumn || !hasCodigoColorColumn) {
      return res.status(400).json({ error: "Las columnas modelo_grupo y codigo_color son requeridas" });
    }
    const supabase = getSupabase();
    
    // Find products where modelo_grupo contains a hyphen (compound format like "W5BP39KACM2-F0D9")
    // and codigo_color is null or empty (not yet normalized)
    const { data: products, error } = await supabase
      .from("productos")
      .select("id_producto, sku, modelo_grupo, codigo_color, talla, activo")
      .eq("activo", true)
      .not("modelo_grupo", "is", null)
      .or("codigo_color.is.null,codigo_color.eq.")
      .limit(2000);
    
    if (error) throw error;
    
    // Filter products where modelo_grupo contains a hyphen (compound format)
    const compoundPattern = /^(.+)-(.+)$/;
    const toNormalize = (products || []).filter((p: any) => {
      if (!p.modelo_grupo) return false;
      const match = p.modelo_grupo.match(compoundPattern);
      return match !== null;
    }).map((p: any) => {
      const match = p.modelo_grupo.match(compoundPattern)!;
      return {
        id_producto: p.id_producto,
        sku: p.sku,
        modelo_grupo_actual: p.modelo_grupo,
        codigo_color_actual: p.codigo_color || null,
        modelo_grupo_nuevo: match[1].trim(),
        codigo_color_nuevo: match[2].trim(),
        talla: p.talla
      };
    });
    
    res.json({ products: toNormalize, total: toNormalize.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/normalize-apply - Apply normalization (split compound modelo_grupo)
app.post("/api/productos/normalize-apply", async (req, res) => {
  try {
    await detectSchema();
    if (!hasModeloGrupoColumn || !hasCodigoColorColumn) {
      return res.status(400).json({ error: "Las columnas modelo_grupo y codigo_color son requeridas" });
    }
    const supabase = getSupabase();
    const { ids } = req.body; // array of id_producto to normalize
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" });
    }
    
    const compoundPattern = /^(.+)-(.+)$/;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    
    // Process in batches of 50
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const { data: products } = await supabase
        .from("productos")
        .select("id_producto, modelo_grupo, codigo_color")
        .in("id_producto", batch);
      
      if (!products) continue;
      
      for (const p of products) {
        if (!p.modelo_grupo) { skipped++; continue; }
        const match = p.modelo_grupo.match(compoundPattern);
        if (!match) { skipped++; continue; }
        
        const newModelo = match[1].trim();
        const newColor = match[2].trim();
        
        const { error: uErr } = await supabase
          .from("productos")
          .update({
            modelo_grupo: newModelo,
            codigo_color: newColor
          })
          .eq("id_producto", p.id_producto);
        
        if (uErr) {
          errors.push(`ID ${p.id_producto}: ${uErr.message}`);
        } else {
          updated++;
        }
      }
    }
    
    res.json({ updated, skipped, errors, total: ids.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/conceptos/temporadas - Get dynamic seasons with usage counts
app.get("/api/conceptos/temporadas", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: seasons, error: sErr } = await supabase
      .from("temporadas")
      .select("nombre")
      .order("nombre", { ascending: true });
      
    if (sErr) throw sErr;

    // Get count of products using each season
    const { data: counts, error: cErr } = await supabase
      .from("productos")
      .select("temporada");
      
    const countMap: Record<string, number> = {};
    if (!cErr && counts) {
      counts.forEach((p: any) => {
        const val = p.temporada || 'todouso';
        countMap[val] = (countMap[val] || 0) + 1;
      });
    }

    const result = seasons.map((s: any) => ({
      nombre: s.nombre,
      productos_count: countMap[s.nombre] || 0
    }));
      
    res.json(result);
  } catch (error: any) {
    // Fallback if table doesn't exist yet
    const defaults = ['verano', 'invierno', 'entretiempo', 'todouso'];
    res.json(defaults.map(d => ({ nombre: d, productos_count: 0 })));
  }
});

// POST /api/conceptos/temporadas - Add a dynamic season
app.post("/api/conceptos/temporadas", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de temporada inválido o vacío" });
    }
    const cleanNombre = nombre.toLowerCase();
    
    const { data, error } = await supabase
      .from("temporadas")
      .insert([{ nombre: cleanNombre }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/conceptos/temporadas/:nombre - Delete a dynamic season
app.delete("/api/conceptos/temporadas/:nombre", async (req, res) => {
  try {
    const supabase = getSupabase();
    const nombre = sanitizeIdentifier(req.params.nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de temporada inválido o vacío" });
    }
    
    const { error } = await supabase
      .from("temporadas")
      .delete()
      .eq("nombre", nombre);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/conceptos/tipos - Get dynamic product types with usage counts
app.get("/api/conceptos/tipos", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: types, error: tErr } = await supabase
      .from("tipos_producto")
      .select("nombre")
      .order("nombre", { ascending: true });
      
    if (tErr) throw tErr;

    // Get count of products using each type
    const { data: counts, error: cErr } = await supabase
      .from("productos")
      .select("tipo");
      
    const countMap: Record<string, number> = {};
    if (!cErr && counts) {
      counts.forEach((p: any) => {
        const val = p.tipo || 'otro';
        countMap[val] = (countMap[val] || 0) + 1;
      });
    }

    const result = types.map((t: any) => ({
      nombre: t.nombre,
      productos_count: countMap[t.nombre] || 0
    }));
      
    res.json(result);
  } catch (error: any) {
    // Fallback if table doesn't exist yet
    const defaults = ['pantalon', 'accesorio', 'camisa', 'calzado', 'chaqueta', 'otro'];
    res.json(defaults.map(d => ({ nombre: d, productos_count: 0 })));
  }
});

// POST /api/conceptos/tipos - Add a dynamic product type
app.post("/api/conceptos/tipos", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de tipo inválido o vacío" });
    }
    const cleanNombre = nombre.toLowerCase();
    
    const { data, error } = await supabase
      .from("tipos_producto")
      .insert([{ nombre: cleanNombre }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/conceptos/tipos/:nombre - Delete a dynamic product type
app.delete("/api/conceptos/tipos/:nombre", async (req, res) => {
  try {
    const supabase = getSupabase();
    const nombre = sanitizeIdentifier(req.params.nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de tipo inválido o vacío" });
    }
    
    const { error } = await supabase
      .from("tipos_producto")
      .delete()
      .eq("nombre", nombre);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/conceptos/marcas - Get dynamic sub-brands with usage counts
app.get("/api/conceptos/marcas", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: marcas, error: mErr } = await supabase
      .from("sub_marcas")
      .select("nombre")
      .order("nombre", { ascending: true });
      
    if (mErr) throw mErr;

    // Get count of products using each sub-brand
    const { data: counts, error: cErr } = await supabase
      .from("productos")
      .select("marca_sub");
      
    const countMap: Record<string, number> = {};
    if (!cErr && counts) {
      counts.forEach((p: any) => {
        const val = p.marca_sub || 'Guess';
        countMap[val] = (countMap[val] || 0) + 1;
      });
    }

    const result = marcas.map((m: any) => ({
      nombre: m.nombre,
      productos_count: countMap[m.nombre] || 0
    }));
      
    res.json(result);
  } catch (error: any) {
    // Fallback if table doesn't exist yet
    const defaults = ['Guess', 'Marciano', 'GuessEco'];
    
    // Also try to get counts from products even in fallback
    let countMap: Record<string, number> = {};
    try {
      const supabase = getSupabase();
      const { data: counts } = await supabase.from("productos").select("marca_sub");
      if (counts) {
        counts.forEach((p: any) => {
          const val = p.marca_sub || 'Guess';
          countMap[val] = (countMap[val] || 0) + 1;
        });
      }
    } catch (_) {}

    res.json(defaults.map(d => ({ nombre: d, productos_count: countMap[d] || 0 })));
  }
});

// POST /api/conceptos/marcas - Add a dynamic sub-brand
app.post("/api/conceptos/marcas", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de marca inválido o vacío" });
    }
    
    const { data, error } = await supabase
      .from("sub_marcas")
      .insert([{ nombre }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/conceptos/marcas/:nombre - Delete a dynamic sub-brand
app.delete("/api/conceptos/marcas/:nombre", async (req, res) => {
  try {
    const supabase = getSupabase();
    const nombre = sanitizeIdentifier(req.params.nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "Nombre de marca inválido o vacío" });
    }
    
    const { error } = await supabase
      .from("sub_marcas")
      .delete()
      .eq("nombre", nombre);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/consultar-caja/:query - Fetch box inventory by box SKU or number
app.get("/api/consultar-caja/:query", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { query } = req.params;
    
    // Find the box in the vista_total_cajas view to get section/warehouse names
    const { data: caja, error: cErr } = await supabase
      .from("vista_total_cajas")
      .select("*")
      .or(`sku.eq.${query},numero_caja.eq.${query}`)
      .maybeSingle();
      
    if (cErr) throw cErr;
    if (!caja) {
      return res.status(404).json({ error: "Caja no encontrada" });
    }
    
    // Fetch products inside the box
    const { data: productos, error: pErr } = await supabase
      .from("caja_productos")
      .select(`
        id_producto,
        cantidad,
        productos (id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at)
      `)
      .eq("id_caja", caja.id_caja);
      
    if (pErr) throw pErr;
    
    res.json({
      ...caja,
      productos: productos || []
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/consultar-seccion/:query - Fetch section levels, boxes, and products
app.get("/api/consultar-seccion/:query", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { query } = req.params;
    
    let dbQuery = supabase.from("zonas_seccion").select(`
      id_zona_seccion,
      nombre,
      id_zona_almacen,
      id_zona_pasillo,
      tags,
      zonas_almacen (nombre),
      zonas_pasillo (
        nombre,
        id_zona_almacen,
        zonas_almacen (nombre)
      )
    `);
    
    const cleanQuery = query.trim();
    const idMatch = cleanQuery.match(/^SEC-(\d+)$/i);
    const numericId = idMatch ? parseInt(idMatch[1]) : parseInt(cleanQuery);
    
    if (!isNaN(numericId)) {
      dbQuery = dbQuery.eq("id_zona_seccion", numericId);
    } else {
      dbQuery = dbQuery.ilike("nombre", cleanQuery);
    }
    
    const { data: section, error: sErr } = await dbQuery.maybeSingle();
    
    if (sErr) throw sErr;
    if (!section) {
      return res.status(404).json({ error: "Sección no encontrada" });
    }
    
    // Find all boxes inside this section
    const { data: boxes, error: bErr } = await supabase
      .from("vista_total_cajas")
      .select("*")
      .eq("id_zona_seccion", section.id_zona_seccion);
      
    if (bErr) throw bErr;
    
    const boxIds = (boxes || []).map(b => b.id_caja);
    let productos: any[] = [];
    
    if (boxIds.length > 0) {
      const { data: prodData, error: pErr } = await supabase
        .from("caja_productos")
        .select(`
          id_caja,
          id_producto,
          cantidad,
          productos (${getProductFields()})
        `)
        .in("id_caja", boxIds);
        
      if (pErr) throw pErr;
      productos = prodData || [];
    }
    
    res.json({
      section: {
        id_zona_seccion: section.id_zona_seccion,
        nombre: section.nombre,
        tags: section.tags,
        pasillo_nombre: section.zonas_pasillo ? section.zonas_pasillo.nombre : "Sin pasillo",
        almacen_nombre: section.zonas_pasillo && section.zonas_pasillo.zonas_almacen 
          ? section.zonas_pasillo.zonas_almacen.nombre 
          : (section.zonas_almacen ? section.zonas_almacen.nombre : "Sin almacén")
      },
      boxes: boxes || [],
      productos: productos
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/consultar-producto/:query - Query boxes containing a specific product by SKU or EAN-13
app.get("/api/consultar-producto/:query", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { query } = req.params;
    
    // Find the product by SKU or EAN-13 (layered search: exact → ilike → partial)
    const cleanQuery = query.replace(/[\s\-]/g, '').trim();
    const fields = `id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at${hasModeloGrupoColumn ? ", modelo_grupo" : ""}`;
    
    let product: any = null;

    // 1. Exact match (fast)
    const { data: exact, error: exactErr } = await supabase
      .from("productos")
      .select(fields)
      .or(`sku.eq.${query},ean_13.eq.${query}`)
      .maybeSingle();
    if (!exactErr && exact) product = exact;

    // 2. Case-insensitive / stripped match
    if (!product) {
      const { data: ilikeMatch } = await supabase
        .from("productos")
        .select(fields)
        .or(`sku.ilike.${query},ean_13.ilike.${query}`)
        .maybeSingle();
      if (ilikeMatch) product = ilikeMatch;
    }

    // 3. Stripped (no spaces/dashes) match
    if (!product && cleanQuery !== query) {
      // 3a. Exact match con el query limpio (sin espacios/guiones)
      const { data: exactClean } = await supabase
        .from("productos")
        .select(fields)
        .or(`sku.eq.${cleanQuery},ean_13.eq.${cleanQuery}`)
        .maybeSingle();
      if (exactClean) product = exactClean;

      // 3b. Partial ilike con el query limpio
      if (!product) {
        const { data: strippedMatch } = await supabase
          .from("productos")
          .select(fields)
          .or(`sku.ilike.%${cleanQuery}%,ean_13.ilike.%${cleanQuery}%`)
          .maybeSingle();
        if (strippedMatch) product = strippedMatch;
      }
    }

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado", query });
    }
    
    // Get boxes containing this product, with nested warehouse section and warehouse zone info
    const { data: boxes, error: bErr } = await supabase
      .from("caja_productos")
      .select(`
        cantidad,
        cajas (
          id_caja, 
          numero_caja, 
          sku, 
          estado,
          id_zona_seccion,
          id_zona_almacen,
          zonas_seccion (
            nombre,
            zonas_almacen (nombre)
          ),
          zonas_almacen (
            nombre
          )
        )
      `)
      .eq("id_producto", product.id_producto);
      
    if (bErr) throw bErr;
    
    const resultBoxes = (boxes || []).map((b: any) => {
      const c = b.cajas;
      const seccion = c.zonas_seccion;
      const almacen = seccion ? seccion.zonas_almacen : c.zonas_almacen;
      return {
        cantidad: b.cantidad,
        cajas: {
          id_caja: c.id_caja,
          numero_caja: c.numero_caja,
          sku: c.sku,
          estado: c.estado,
          id_zona_seccion: c.id_zona_seccion,
          id_zona_almacen: c.id_zona_almacen,
          seccion_nombre: seccion ? seccion.nombre : null,
          almacen_nombre: almacen ? almacen.nombre : null
        }
      };
    });
    
    // Fetch product variants of same group model (excluding original)
    let variantes: any[] = [];
    if (hasModeloGrupoColumn && product.modelo_grupo && product.modelo_grupo !== "sin modelo") {
      const { data: vData } = await supabase
        .from("productos")
        .select(fields)
        .eq("modelo_grupo", product.modelo_grupo)
        .neq("id_producto", product.id_producto);
      variantes = vData || [];

      if (variantes.length > 0) {
        const variantIds = variantes.map((v: any) => v.id_producto);
        const { data: qData } = await supabase
          .from("caja_productos")
          .select("id_producto, cantidad")
          .in("id_producto", variantIds);
        
        const qtyMap: { [key: number]: number } = {};
        if (qData) {
          for (const item of qData) {
            qtyMap[item.id_producto] = (qtyMap[item.id_producto] || 0) + (item.cantidad || 0);
          }
        }
        
        variantes = variantes.map((v: any) => ({
          ...v,
          total_cantidad: qtyMap[v.id_producto] || 0
        }));
      }
    }

    res.json({
      product: { modelo_grupo: "sin modelo", ...product },
      boxes: resultBoxes,
      variantes: variantes.map((v: any) => ({ modelo_grupo: "sin modelo", ...v }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/consultar-productos-batch - Batch search for multiple UPCs/SKUs at once
app.post("/api/consultar-productos-batch", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { queries } = req.body;
    
    if (!Array.isArray(queries) || queries.length === 0) {
      return res.status(400).json({ error: "queries array required" });
    }

    const limited = queries.slice(0, 300);
    const fields = `id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at${hasModeloGrupoColumn ? ", modelo_grupo" : ""}`;
    
    // 1. Fetch ALL active products
    const { data: allProducts, error: pErr } = await supabase
      .from("productos")
      .select(fields)
      .eq("activo", true);
    
    if (pErr) throw pErr;

    // Build product lookup maps
    const exactMap = new Map<string, any>();
    const strippedMap = new Map<string, any>();
    const modeloMap = new Map<string, any[]>(); // modelo_grupo lowercase -> [products]
    
    for (const product of (allProducts || [])) {
      if (product.sku) {
        exactMap.set(product.sku.toLowerCase(), product);
        strippedMap.set(product.sku.replace(/[\s\-]/g, '').toLowerCase(), product);
      }
      if (product.ean_13) {
        exactMap.set(product.ean_13.toLowerCase(), product);
        strippedMap.set(product.ean_13.replace(/[\s\-]/g, '').toLowerCase(), product);
      }
      if (hasModeloGrupoColumn && product.modelo_grupo) {
        const mg = product.modelo_grupo.toLowerCase();
        const existing = modeloMap.get(mg) || [];
        existing.push(product);
        modeloMap.set(mg, existing);
      }
    }

    // 2. Match each query: sku/ean → modelo_grupo
    const queryProductMap = new Map<number, any>();
    
    for (let i = 0; i < limited.length; i++) {
      const q = limited[i];
      const sku = (typeof q === 'object' ? q.sku : q)?.trim() || '';
      const modelo = (typeof q === 'object' ? q.modelo : '')?.trim() || '';
      const skuLower = sku.toLowerCase();
      const skuStripped = sku.replace(/[\s\-]/g, '').toLowerCase();
      
      // a) Exact/stripped match on sku or ean_13
      let product = exactMap.get(skuLower) || strippedMap.get(skuStripped);
      
      // b) Partial match on sku or ean_13
      if (!product && skuStripped.length >= 6) {
        for (const [key, p] of strippedMap) {
          if (key === skuStripped || key.includes(skuStripped) || skuStripped.includes(key)) { product = p; break; }
        }
      }
      
      // c) Match by modelo_grupo: exact match first, then prefix match
      if (!product && modelo && hasModeloGrupoColumn) {
        const modeloLower = modelo.toLowerCase();
        // Exact match
        const exactMatch = modeloMap.get(modeloLower);
        if (exactMatch && exactMatch.length > 0) {
          product = exactMatch[0];
        } else {
          // Prefix match: "W5BP39KACM2" should match "W5BP39KACM2-G1H3"
          for (const [key, products] of modeloMap) {
            if (key.startsWith(modeloLower + '-') || key === modeloLower) {
              product = products[0];
              break;
            }
          }
        }
      }
      
      if (product) {
        queryProductMap.set(i, product);
      }
    }

    // 3. Collect ALL product IDs including ALL variants of matched modelo_grupo
    const allRelevantIds = new Set<number>();
    for (const [, product] of queryProductMap) {
      allRelevantIds.add(product.id_producto);
      // Also add ALL products with same modelo_grupo (variants: different sizes/colors)
      if (hasModeloGrupoColumn && product.modelo_grupo) {
        const mg = product.modelo_grupo.toLowerCase();
        const variants = modeloMap.get(mg) || [];
        for (const p of variants) {
          allRelevantIds.add(p.id_producto);
        }
      }
    }

    console.log(`[Batch] Matched ${queryProductMap.size} products, ${allRelevantIds.size} total variant IDs`);

    // 4. Fetch boxes for ALL relevant products
    const boxMap = new Map<number, any[]>();
    const productIds = [...allRelevantIds];
    
    // Fetch all caja_productos for these IDs with proper join
    if (productIds.length > 0) {
      for (let ci = 0; ci < productIds.length; ci += 50) {
        const chunk = productIds.slice(ci, ci + 50);
        console.log(`[Batch] Fetching caja_productos for chunk ${ci} (${chunk.length} IDs)`);
        
        const { data: cajaProd, error: cpErr } = await supabase
          .from("caja_productos")
          .select(`
            id_producto,
            cantidad,
            cajas (
              id_caja,
              numero_caja,
              sku,
              estado,
              id_zona_seccion,
              id_zona_almacen,
              zonas_seccion (
                nombre,
                zonas_almacen (nombre)
              ),
              zonas_almacen (
                nombre
              )
            )
          `)
          .in("id_producto", chunk);
        
        if (cpErr) {
          console.error(`[Batch] Error fetching caja_productos for chunk ${ci}:`, cpErr);
        }
        
        if (cajaProd && cajaProd.length > 0) {
          console.log(`[Batch] Found ${cajaProd.length} caja_productos entries for chunk ${ci}`);
          for (const cp of cajaProd) {
            const existing = boxMap.get(cp.id_producto) || [];
            const c = cp.cajas as any;
            const seccion = c?.zonas_seccion;
            const almacen = seccion ? seccion.zonas_almacen : c?.zonas_almacen;
            existing.push({
              cantidad: cp.cantidad,
              cajas: {
                id_caja: c?.id_caja,
                numero_caja: c?.numero_caja,
                sku: c?.sku,
                estado: c?.estado,
                id_zona_seccion: c?.id_zona_seccion,
                id_zona_almacen: c?.id_zona_almacen,
                seccion_nombre: seccion?.nombre || null,
                almacen_nombre: almacen?.nombre || null
              }
            });
            boxMap.set(cp.id_producto, existing);
          }
        } else {
          console.log(`[Batch] No caja_productos found for chunk ${ci} (${chunk.length} IDs)`);
        }
      }
    }

    // Fallback: if no boxes found via direct query, try fetching by cajas.sku for each matched product
    if (boxMap.size === 0) {
      console.log(`[Batch] Fallback: trying to find boxes via cajas.sku`);
      for (const [queryIdx, product] of queryProductMap) {
        // Try matching by SKU
        if (product.sku) {
          const { data: caja } = await supabase
            .from("vista_total_cajas")
            .select("*")
            .eq("sku", product.sku)
            .maybeSingle();
          
          if (caja) {
            const { data: prods } = await supabase
              .from("caja_productos")
              .select("id_producto, cantidad")
              .eq("id_caja", caja.id_caja);
            
            // Find the matching product in the box
            for (const cp of prods || []) {
              if (cp.id_producto === product.id_producto) {
                const existing = boxMap.get(product.id_producto) || [];
                existing.push({
                  cantidad: cp.cantidad,
                  cajas: {
                    id_caja: caja.id_caja,
                    numero_caja: caja.numero_caja,
                    sku: caja.sku,
                    estado: caja.estado,
                    id_zona_seccion: caja.id_zona_seccion,
                    id_zona_almacen: caja.id_zona_almacen,
                    seccion_nombre: caja.zonas_seccion?.nombre || null,
                    almacen_nombre: caja.zonas_seccion?.zonas_almacen?.nombre || caja.zonas_almacen?.nombre || null
                  }
                });
                boxMap.set(product.id_producto, existing);
                console.log(`[Batch] Found box via cajas.sku for product ${product.id_producto}`);
                break;
              }
            }
          }
        }
        
        // Try matching by EAN_13
        if (product.ean_13 && !boxMap.has(product.id_producto)) {
          const { data: caja } = await supabase
            .from("vista_total_cajas")
            .select("*")
            .eq("sku", product.ean_13)
            .maybeSingle();
          
          if (caja) {
            const { data: prods } = await supabase
              .from("caja_productos")
              .select("id_producto, cantidad")
              .eq("id_caja", caja.id_caja);
            
            for (const cp of prods || []) {
              if (cp.id_producto === product.id_producto) {
                const existing = boxMap.get(product.id_producto) || [];
                existing.push({
                  cantidad: cp.cantidad,
                  cajas: {
                    id_caja: caja.id_caja,
                    numero_caja: caja.numero_caja,
                    sku: caja.sku,
                    estado: caja.estado,
                    id_zona_seccion: caja.id_zona_seccion,
                    id_zona_almacen: caja.id_zona_almacen,
                    seccion_nombre: caja.zonas_seccion?.nombre || null,
                    almacen_nombre: caja.zonas_seccion?.zonas_almacen?.nombre || caja.zonas_almacen?.nombre || null
                  }
                });
                boxMap.set(product.id_producto, existing);
                console.log(`[Batch] Found box via cajas.sku (EAN) for product ${product.id_producto}`);
                break;
              }
            }
          }
        }
      }
    }

    console.log(`[Batch] Box map has ${boxMap.size} products with boxes`);

    // 5. Build results: aggregate boxes from ALL variants of same modelo_grupo
    const results = limited.map((q: any, i: number) => {
      const product = queryProductMap.get(i);
      if (!product) return { query: q, found: false, product: null, boxes: [] };
      
      // Collect boxes from ALL variants of this modelo_grupo
      let allBoxes: any[] = [];
      if (hasModeloGrupoColumn && product.modelo_grupo) {
        const mg = product.modelo_grupo.toLowerCase();
        const variants = modeloMap.get(mg) || [];
        for (const v of variants) {
          const vBoxes = boxMap.get(v.id_producto) || [];
          allBoxes = allBoxes.concat(vBoxes);
        }
      } else {
        allBoxes = boxMap.get(product.id_producto) || [];
      }
      
      return {
        query: q,
        found: true,
        product: { modelo_grupo: "sin modelo", ...product },
        boxes: allBoxes
      };
    });

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/consultar-dinamico/:query - Unified dynamic lookup for section, box, or product
app.get("/api/consultar-dinamico/:query", async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    const { query } = req.params;
    const cleanQuery = query.trim();

    // 1. Check Section by SEC-ID or by name
    const secMatch = cleanQuery.match(/^SEC-(\d+)$/i);
    const secNumericId = secMatch ? parseInt(secMatch[1]) : parseInt(cleanQuery);
    
    let sectionQuery = supabase.from("zonas_seccion").select(`
      id_zona_seccion,
      nombre,
      id_zona_almacen,
      id_zona_pasillo,
      tags,
      zonas_almacen (nombre),
      zonas_pasillo (
        nombre,
        id_zona_almacen,
        zonas_almacen (nombre)
      )
    `);
    
    if (!isNaN(secNumericId)) {
      sectionQuery = sectionQuery.eq("id_zona_seccion", secNumericId);
    } else {
      sectionQuery = sectionQuery.ilike("nombre", cleanQuery);
    }
    
    const { data: section } = await sectionQuery.maybeSingle();
    
    // Determine dynamic fields
    const prodFields = getProductFields();
    const prodFieldsWithActive = getProductFields();
    
    if (section) {
      // It is a Section! Fetch section boxes
      const { data: boxes } = await supabase
        .from("vista_total_cajas")
        .select("*")
        .eq("id_zona_seccion", section.id_zona_seccion);
        
      const boxIds = (boxes || []).map(b => b.id_caja);
      let productos: any[] = [];
      
      if (boxIds.length > 0) {
        const { data: prodData } = await supabase
          .from("caja_productos")
          .select(`
            id_caja,
            id_producto,
            cantidad,
            productos (${prodFields})
          `)
          .in("id_caja", boxIds);
          
        productos = (prodData || []).map((item: any) => ({
          ...item,
          productos: item.productos ? { modelo_grupo: "sin modelo", ...item.productos } : null
        }));
      }
      
      return res.json({
        type: "seccion",
        data: {
          section: {
            id_zona_seccion: section.id_zona_seccion,
            nombre: section.nombre,
            tags: section.tags,
            pasillo_nombre: section.zonas_pasillo ? section.zonas_pasillo.nombre : "Sin pasillo",
            almacen_nombre: section.zonas_pasillo && section.zonas_pasillo.zonas_almacen 
              ? section.zonas_pasillo.zonas_almacen.nombre 
              : (section.zonas_almacen ? section.zonas_almacen.nombre : "Sin almacén")
          },
          boxes: boxes || [],
          productos: productos
        }
      });
    }

    // 2. Check Caja (by SKU or numero_caja)
    const { data: caja } = await supabase
      .from("vista_total_cajas")
      .select("*")
      .or(`sku.eq.${cleanQuery},numero_caja.eq.${cleanQuery}`)
      .maybeSingle();
      
    if (caja) {
      // Fetch products inside the box
      const { data: productos } = await supabase
        .from("caja_productos")
        .select(`
          id_producto,
          cantidad,
          productos (${prodFieldsWithActive})
        `)
        .eq("id_caja", caja.id_caja);
        
      const mappedProductos = (productos || []).map((item: any) => ({
        ...item,
        productos: item.productos ? { modelo_grupo: "sin modelo", ...item.productos } : null
      }));

      return res.json({
        type: "caja",
        data: {
          ...caja,
          productos: mappedProductos
        }
      });
    }

    // 3. Check Product (by SKU or EAN-13)
    const { data: product } = await supabase
      .from("productos")
      .select(prodFieldsWithActive)
      .or(`sku.eq.${cleanQuery},ean_13.eq.${cleanQuery}`)
      .maybeSingle();
      
    if (product) {
      // Find boxes containing this product
      const { data: boxes } = await supabase
        .from("caja_productos")
        .select(`
          cantidad,
          cajas (
            id_caja, 
            numero_caja, 
            sku, 
            estado,
            id_zona_seccion,
            id_zona_almacen,
            zonas_seccion (
              nombre,
              zonas_almacen (nombre)
            ),
            zonas_almacen (
              nombre
            )
          )
        `)
        .eq("id_producto", product.id_producto);
        
      const resultBoxes = (boxes || []).map((b: any) => {
        const c = b.cajas;
        const seccion = c.zonas_seccion;
        const almacen = seccion ? seccion.zonas_almacen : c.zonas_almacen;
        return {
          cantidad: b.cantidad,
          cajas: {
            id_caja: c.id_caja,
            numero_caja: c.numero_caja,
            sku: c.sku,
            estado: c.estado,
            id_zona_seccion: c.id_zona_seccion,
            id_zona_almacen: c.id_zona_almacen,
            seccion_nombre: seccion ? seccion.nombre : null,
            almacen_nombre: almacen ? almacen.nombre : null
          }
        };
      });

      // Find variants (same modelo_grupo, excluding the searched product)
      let variantes: any[] = [];
      if (hasModeloGrupoColumn && product.modelo_grupo && product.modelo_grupo !== "sin modelo") {
        const { data: vData } = await supabase
          .from("productos")
          .select(prodFieldsWithActive)
          .eq("modelo_grupo", product.modelo_grupo)
          .neq("id_producto", product.id_producto);
        variantes = vData || [];

        if (variantes.length > 0) {
          const variantIds = variantes.map((v: any) => v.id_producto);
          const { data: qData } = await supabase
            .from("caja_productos")
            .select("id_producto, cantidad")
            .in("id_producto", variantIds);
          
          const qtyMap: { [key: number]: number } = {};
          if (qData) {
            for (const item of qData) {
              qtyMap[item.id_producto] = (qtyMap[item.id_producto] || 0) + (item.cantidad || 0);
            }
          }
          
          variantes = variantes.map((v: any) => ({
            ...v,
            total_cantidad: qtyMap[v.id_producto] || 0
          }));
        }
      }

      return res.json({
        type: "producto",
        data: {
          product: { modelo_grupo: "sin modelo", ...product },
          boxes: resultBoxes,
          variantes: variantes.map((v: any) => ({ modelo_grupo: "sin modelo", ...v }))
        }
      });
    }

    // 4. Check by modelo_grupo (group model search)
    if (hasModeloGrupoColumn) {
      const { data: modeloProducts } = await supabase
        .from("productos")
        .select(prodFieldsWithActive)
        .ilike("modelo_grupo", cleanQuery);

      if (modeloProducts && modeloProducts.length > 0) {
        const productIds = modeloProducts.map((p: any) => p.id_producto);

        // Fetch box assignments for all variants
        const { data: boxAssignments } = await supabase
          .from("caja_productos")
          .select(`
            id_producto,
            cantidad,
            cajas (
              id_caja,
              numero_caja,
              sku,
              estado,
              id_zona_seccion,
              id_zona_almacen,
              zonas_seccion (
                nombre,
                zonas_almacen (nombre)
              ),
              zonas_almacen (nombre)
            )
          `)
          .in("id_producto", productIds);

        // Build per-product totals and box locations
        const boxMap: { [prodId: number]: any[] } = {};
        const totalMap: { [prodId: number]: number } = {};
        for (const item of (boxAssignments || [])) {
          const pid = item.id_producto;
          if (!boxMap[pid]) boxMap[pid] = [];
          if (!totalMap[pid]) totalMap[pid] = 0;
          const c = item.cajas as any;
          if (c) {
            const seccion = c.zonas_seccion;
            const almacen = seccion ? seccion.zonas_almacen : c.zonas_almacen;
            boxMap[pid].push({
              cantidad: item.cantidad,
              cajas: {
                id_caja: c.id_caja,
                numero_caja: c.numero_caja,
                sku: c.sku,
                estado: c.estado,
                seccion_nombre: seccion ? seccion.nombre : null,
                almacen_nombre: almacen ? almacen.nombre : null,
              }
            });
            totalMap[pid] = (totalMap[pid] || 0) + (item.cantidad || 0);
          }
        }

        const variantes = modeloProducts.map((p: any) => ({
          modelo_grupo: cleanQuery,
          ...p,
          boxes: boxMap[p.id_producto] || [],
          total_cantidad: totalMap[p.id_producto] || 0,
        }));

        return res.json({
          type: "modelo",
          data: {
            modelo_grupo: cleanQuery,
            variantes,
            total_unidades: variantes.reduce((sum: number, v: any) => sum + v.total_cantidad, 0),
          }
        });
      }
    }

    // 5. Return 404 if nothing matches
    res.status(404).json({ error: "No se encontró caja, producto, sección o modelo que coincida con el código ingresado" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transferir-producto - Transfer quantity of a product between boxes
app.post("/api/transferir-producto", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id_caja_origen, id_caja_destino, id_producto, cantidad } = req.body;

    if (!id_caja_origen || !id_caja_destino || !id_producto || !cantidad) {
      return res.status(400).json({ error: "Parámetros incompletos para la transferencia" });
    }
    if (parseInt(id_caja_origen) === parseInt(id_caja_destino)) {
      return res.status(400).json({ error: "La caja de origen y destino no pueden ser la misma" });
    }
    
    // 1. Check if product exists in origin box and has enough quantity
    const { data: origItem, error: origErr } = await supabase
      .from("caja_productos")
      .select("*")
      .eq("id_caja", id_caja_origen)
      .eq("id_producto", id_producto)
      .maybeSingle();
      
    if (origErr) throw origErr;
    if (!origItem || origItem.cantidad < cantidad) {
      return res.status(400).json({ error: "La caja origen no cuenta con la cantidad suficiente del producto" });
    }
    
    // 2. Perform transfer
    const newOrigQty = origItem.cantidad - cantidad;
    
    if (newOrigQty === 0) {
      // Delete relation from origin
      const { error: delErr } = await supabase
        .from("caja_productos")
        .delete()
        .eq("id_caja", id_caja_origen)
        .eq("id_producto", id_producto);
      if (delErr) throw delErr;
    } else {
      // Update origin quantity
      const { error: updErr } = await supabase
        .from("caja_productos")
        .update({ cantidad: newOrigQty })
        .eq("id_caja", id_caja_origen)
        .eq("id_producto", id_producto);
      if (updErr) throw updErr;
    }
    
    // Check if product already exists in target box
    const { data: destItem, error: destErr } = await supabase
      .from("caja_productos")
      .select("*")
      .eq("id_caja", id_caja_destino)
      .eq("id_producto", id_producto)
      .maybeSingle();
      
    if (destErr) throw destErr;
    
    if (destItem) {
      // Update destination quantity
      const { error: destUpdErr } = await supabase
        .from("caja_productos")
        .update({ cantidad: destItem.cantidad + cantidad })
        .eq("id_caja", id_caja_destino)
        .eq("id_producto", id_producto);
      if (destUpdErr) throw destUpdErr;
    } else {
      // Insert new relation at destination
      const { error: insErr } = await supabase
        .from("caja_productos")
        .insert([{ id_caja: id_caja_destino, id_producto, cantidad }]);
      if (insErr) throw insErr;
    }
    
    // 3. Update origin box state if it is now empty
    const { data: remainingOrig } = await supabase
      .from("caja_productos")
      .select("cantidad")
      .eq("id_caja", id_caja_origen);
      
    if (!remainingOrig || remainingOrig.length === 0) {
      await supabase.from("cajas").update({ estado: 'vacia' }).eq("id_caja", id_caja_origen);
    }
    
    // 4. Update destination box state if it was empty
    const { data: destBox } = await supabase
      .from("cajas")
      .select("estado")
      .eq("id_caja", id_caja_destino)
      .single();
      
    if (destBox && destBox.estado === 'vacia') {
      await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", id_caja_destino);
    }

    // Broadcast the transfer event to all connected clients
    emitDomainEvent("caja:updated", {
      action: "transferir-producto",
      id_caja_origen: parseInt(id_caja_origen),
      id_caja_destino: parseInt(id_caja_destino),
      id_producto: parseInt(id_producto),
      cantidad,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cajas/transferir-todo - Transfer all products from origin box to destination box
app.post("/api/cajas/transferir-todo", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id_caja_origen, id_caja_destino } = req.body;

    if (!id_caja_origen || !id_caja_destino) {
      return res.status(400).json({ error: "Faltan parámetros requeridos" });
    }

    if (parseInt(id_caja_origen) === parseInt(id_caja_destino)) {
      return res.status(400).json({ error: "La caja de origen y destino no pueden ser la misma" });
    }

    // ―― Concurrency lock: prevent two simultaneous transfers of the same box ――
    const origenId = parseInt(id_caja_origen);
    if (transferLocks.has(origenId)) {
      return res.status(409).json({
        error: "Esta caja ya está siendo transferida por otro operario. Intenta de nuevo en unos segundos."
      });
    }
    transferLocks.add(origenId);

    try {
      // 1. Fetch all products from origin box
      const { data: origItems, error: origErr } = await supabase
        .from("caja_productos")
        .select("*")
        .eq("id_caja", id_caja_origen);

      if (origErr) throw origErr;

      if (!origItems || origItems.length === 0) {
        await supabase.from("cajas").update({ estado: 'vacia' }).eq("id_caja", id_caja_origen);
        const { data: destBox } = await supabase
          .from("cajas").select("estado").eq("id_caja", id_caja_destino).single();
        if (destBox && destBox.estado === 'vacia') {
          await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", id_caja_destino);
        }
        return res.json({ success: true, message: "No había productos que transferir" });
      }

      // 2. Perform transfer for each product
      for (const item of origItems) {
        const id_producto = item.id_producto;
        const cantidad = item.cantidad;

        const { data: destItem, error: destErr } = await supabase
          .from("caja_productos")
          .select("*")
          .eq("id_caja", id_caja_destino)
          .eq("id_producto", id_producto)
          .maybeSingle();

        if (destErr) throw destErr;

        if (destItem) {
          const { error: destUpdErr } = await supabase
            .from("caja_productos")
            .update({ cantidad: destItem.cantidad + cantidad })
            .eq("id_caja", id_caja_destino)
            .eq("id_producto", id_producto);
          if (destUpdErr) throw destUpdErr;
        } else {
          const { error: insErr } = await supabase
            .from("caja_productos")
            .insert([{ id_caja: id_caja_destino, id_producto, cantidad }]);
          if (insErr) throw insErr;
        }
      }

      // 3. Delete all relations from origin box
      const { error: delErr } = await supabase
        .from("caja_productos").delete().eq("id_caja", id_caja_origen);
      if (delErr) throw delErr;

      // 4. Update states
      await supabase.from("cajas").update({ estado: 'vacia' }).eq("id_caja", id_caja_origen);
      const { data: destBox } = await supabase
        .from("cajas").select("estado").eq("id_caja", id_caja_destino).single();
      if (destBox && destBox.estado === 'vacia') {
        await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", id_caja_destino);
      }

      // 5. Broadcast to all clients
      emitDomainEvent("caja:updated", {
        action: "transferir-todo",
        id_caja_origen: origenId,
        id_caja_destino: parseInt(id_caja_destino),
        total_productos: origItems.length,
      });

      res.json({ success: true });
    } finally {
      transferLocks.delete(origenId); // Always release lock
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});




// --- FASE 1: JERARQUÍA DE ALMACENAMIENTO, AJUSTES Y SSE ---

// GET /api/hierarchy - List all hierarchical containers
app.get("/api/hierarchy", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("storage_hierarchy")
      .select("*")
      .order("id", { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/hierarchy/settings - Get settings
app.get("/api/hierarchy/settings", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("warehouse_settings")
      .select("*");
    
    if (error) throw error;
    
    const settings: Record<string, any> = {};
    data?.forEach((s: any) => {
      settings[s.clave] = s.valor;
    });
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/hierarchy/settings - Update settings
app.put("/api/hierarchy/settings", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { prefijos, secuencias, tipos_contenedor } = req.body;
    
    if (prefijos) {
      await supabase.from("warehouse_settings").upsert({ clave: "prefijos", valor: prefijos });
    }
    if (secuencias) {
      await supabase.from("warehouse_settings").upsert({ clave: "secuencias", valor: secuencias });
    }
    if (tipos_contenedor) {
      await supabase.from("warehouse_settings").upsert({ clave: "tipos_contenedor", valor: tipos_contenedor });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/hierarchy - Create a new container
app.post("/api/hierarchy", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { parent_id, tipo_almacen, sku_asociado, stock_real = 0, codigo_barras } = req.body;
    
    // Auto-generate barcode if not provided
    if (!codigo_barras) {
      // Get settings
      const { data: settingsData } = await supabase
        .from("warehouse_settings")
        .select("*");
      
      const prefijos = settingsData?.find((s: any) => s.clave === "prefijos")?.valor || {};
      const secuencias = settingsData?.find((s: any) => s.clave === "secuencias")?.valor || {};
      
      const prefix = prefijos[tipo_almacen] || "CON";
      const seq = parseInt(secuencias[tipo_almacen] || "1");
      
      // Auto-increment sequence in settings
      const nextSeq = seq + 1;
      const updatedSecuencias = { ...secuencias, [tipo_almacen]: nextSeq };
      await supabase.from("warehouse_settings").upsert({ clave: "secuencias", valor: updatedSecuencias });
      
      // Format code: PREFIX-0000X
      codigo_barras = `${prefix}-${String(seq).padStart(5, '0')}`;
    }
    
    const insertData = {
      parent_id: parent_id ? parseInt(parent_id) : null,
      tipo_almacen,
      sku_asociado: sku_asociado || null,
      codigo_barras,
      stock_real: parseInt(stock_real) || 0
    };
    
    const { data, error } = await supabase
      .from("storage_hierarchy")
      .insert([insertData])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/hierarchy/:id - Update node in hierarchy
app.put("/api/hierarchy/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    const { parent_id, tipo_almacen, sku_asociado, stock_real, codigo_barras } = req.body;
    
    const updateData: any = {};
    if (parent_id !== undefined) updateData.parent_id = parent_id ? parseInt(parent_id) : null;
    if (tipo_almacen !== undefined) updateData.tipo_almacen = tipo_almacen;
    if (sku_asociado !== undefined) updateData.sku_asociado = sku_asociado || null;
    if (stock_real !== undefined) updateData.stock_real = parseInt(stock_real) || 0;
    if (codigo_barras !== undefined) updateData.codigo_barras = codigo_barras;
    
    const { data, error } = await supabase
      .from("storage_hierarchy")
      .update(updateData)
      .eq("id", id)
      .select();
      
    if (error) throw error;
    
    // Emit stock update event if stock was changed
    if (stock_real !== undefined) {
      stockEvents.emit("stock-change", { id, stock_real: parseInt(stock_real) || 0 });
    }
    
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/hierarchy/:id - Delete node in hierarchy
app.delete("/api/hierarchy/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    
    const { error } = await supabase
      .from("storage_hierarchy")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/hierarchy/:id/stock-live - SSE Stream for real-time stock
app.get("/api/hierarchy/:id/stock-live", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "ID inválido" });
  }
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);
  
  // Listen to stock-change events
  const onStockChange = (data: any) => {
    if (data.id === id) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };
  
  stockEvents.on("stock-change", onStockChange);
  
  // Keep connection alive with periodic pings
  const intervalId = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);
  
  req.on("close", () => {
    stockEvents.off("stock-change", onStockChange);
    clearInterval(intervalId);
  });
});

// ── GET /api/events/stream ─ Global SSE bus for domain events ─────────────────
// Clients connect once and receive all relevant inventory events in real time.
app.get("/api/events/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  activeSseClients++;
  // Send initial handshake
  res.write(`data: ${JSON.stringify({ type: "connected", clients: activeSseClients })}\n\n`);

  // Forward any domain event to this client
  const onEvent = (event: object) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  };
  domainEvents.on("event", onEvent);

  // Keepalive ping every 20s
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 20000);

  req.on("close", () => {
    activeSseClients = Math.max(0, activeSseClients - 1);
    domainEvents.off("event", onEvent);
    clearInterval(ping);
  });
});

// Helper — emit a typed domain event to all SSE clients
const emitDomainEvent = (type: string, payload: object = {}) => {
  domainEvents.emit("event", { type, ts: Date.now(), ...payload });
};

// ── SUPABASE REALTIME → SSE BRIDGE ─────────────────────────────────────────
// El backend se suscribe a cambios de Postgres (hechos por CUALQUIER cliente:
// apps móviles, SQL editor, otros servicios) y los re-emite por el bus SSE
// a las apps conectadas. Así los cambios externos se reflejan sin reabrir apps.
try {
  const realtimeChannel = getSupabase().channel("db-to-sse-bridge");

  const REALTIME_MAP: Record<string, { insert?: string; update?: string; delete?: string }> = {
    cajas: { insert: "caja:updated", update: "caja:updated", delete: "caja:deleted" },
    caja_productos: { insert: "caja:updated", update: "caja:updated", delete: "caja:updated" },
    productos: { insert: "producto:batch-registered", update: "producto:updated", delete: "producto:deleted" },
    loyalty_solicitudes_pago: { insert: "pago:solicitado", update: "pago:aprobado" },
    loyalty_facturas: { update: "factura:solicitada" },
    loyalty_compras: { insert: "compra:created" },
    inventory_events: { insert: "inventory:evento", update: "inventory:updated", delete: "inventory:updated" },
    count_requests: { insert: "inventory:updated", update: "inventory:approved", delete: "inventory:updated" }
  };

  realtimeChannel
    .on("postgres_changes", { event: "*", schema: "public", table: "*" }, (payload: any) => {
      try {
        const table = payload?.table as string;
        const eventType = (payload?.eventType || "").toLowerCase() as "insert" | "update" | "delete";
        const mapping = REALTIME_MAP[table];
        const type = mapping?.[eventType];
        if (!type) return;
        const data = payload.new || payload.old || {};
        emitDomainEvent(type, { ...data, _table: table, _origin: "supabase-realtime" });
        console.log(`[Realtime→SSE] ${table}:${eventType} → ${type}`);
      } catch (e) {
        console.error("[Realtime→SSE] error:", e);
      }
    })
    .subscribe((status: string) => {
      console.log(`[Realtime→SSE] suscripción: ${status}`);
    });
} catch (e) {
  console.error("[Realtime→SSE] no se pudo iniciar:", e);
}


// --- FASE 2: GESTIÓN DE CAJAS CJ-X Y POS ---

// POST /api/containers - Create a box CJ-X
app.post("/api/containers", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { sku_validado } = req.body;
    
    if (!sku_validado) {
      return res.status(400).json({ error: "El SKU es obligatorio" });
    }
    
    // 1. Validar que SKU existe
    const { data: prod, error: pErr } = await supabase
      .from("productos")
      .select("sku")
      .eq("sku", sku_validado)
      .maybeSingle();
      
    if (pErr || !prod) {
      return res.status(400).json({ error: "El SKU no existe en la base de datos de productos" });
    }
    
    // 2. Validar que no exista un contenedor activo con este SKU
    const { data: existing, error: exErr } = await supabase
      .from("containers")
      .select("id")
      .eq("sku_validado", sku_validado)
      .in("estado", ["vacia", "activa", "llena"])
      .maybeSingle();
      
    if (existing) {
      return res.status(409).json({ error: "Ya existe un contenedor activo para este SKU de producto" });
    }
    
    // 3. Obtener el máximo sequence_number + 1
    const { data: maxSeqData, error: maxErr } = await supabase
      .from("containers")
      .select("secuencia")
      .eq("prefijo", "CJ")
      .order("secuencia", { ascending: false })
      .limit(1);
      
    let nextSeq = 1;
    if (maxSeqData && maxSeqData.length > 0) {
      nextSeq = maxSeqData[0].secuencia + 1;
    }
    
    // 4. Crear el contenedor
    const { data: newContainer, error: cErr } = await supabase
      .from("containers")
      .insert([{
        prefijo: "CJ",
        secuencia: nextSeq,
        sku_validado,
        estado: "vacia"
      }])
      .select();
      
    if (cErr) throw cErr;
    res.json(newContainer[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/containers/transfer - Transfer box stock and inherit prefix
app.post("/api/containers/transfer", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id_caja_origen, id_caja_destino } = req.body;
    
    if (!id_caja_origen || !id_caja_destino) {
      return res.status(400).json({ error: "IDs de origen y destino requeridos" });
    }
    
    // 1. Obtener cajas
    const { data: origBox, error: oErr } = await supabase
      .from("cajas")
      .select("*")
      .eq("id_caja", id_caja_origen)
      .single();
      
    const { data: destBox, error: dErr } = await supabase
      .from("cajas")
      .select("*")
      .eq("id_caja", id_caja_destino)
      .single();
      
    if (oErr || dErr || !origBox || !destBox) {
      return res.status(404).json({ error: "Una o ambas cajas no existen" });
    }
    
    // 2. Mover todos los productos de la caja origen a la caja destino
    const { data: origProducts } = await supabase
      .from("caja_productos")
      .select("*")
      .eq("id_caja", id_caja_origen);
      
    if (origProducts && origProducts.length > 0) {
      for (const item of origProducts) {
        // Buscar si ya existe en destino
        const { data: destItem } = await supabase
          .from("caja_productos")
          .select("*")
          .eq("id_caja", id_caja_destino)
          .eq("id_producto", item.id_producto)
          .maybeSingle();
          
        if (destItem) {
          await supabase
            .from("caja_productos")
            .update({ cantidad: destItem.cantidad + item.cantidad })
            .eq("id_relacion", destItem.id_relacion);
        } else {
          await supabase
            .from("caja_productos")
            .insert([{
              id_caja: id_caja_destino,
              id_producto: item.id_producto,
              cantidad: item.cantidad
            }]);
        }
      }
      
      // Eliminar de origen
      await supabase
        .from("caja_productos")
        .delete()
        .eq("id_caja", id_caja_origen);
    }
    
    // 3. Heredar prefijo y SKU
    const originalSku = origBox.sku;
    const originalNumero = origBox.numero_caja;
    
    // Actualizar destino con los datos heredados y estado
    await supabase
      .from("cajas")
      .update({
        sku: originalSku,
        estado: origBox.estado,
        temporada_default: origBox.temporada_default
      })
      .eq("id_caja", id_caja_destino);
      
    // 4. Marcar origen como rota/vieja
    await supabase
      .from("cajas")
      .update({
        estado: "vacia",
        sku: `OLD-${originalSku || id_caja_origen}`,
        numero_caja: `${originalNumero} (ROTA)`
      })
      .eq("id_caja", id_caja_origen);
      
    res.json({ success: true, message: "Transferencia completada e identificadores heredados" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/pos/sell - Checkout items in POS (Registro de Salida)
app.post("/api/pos/sell", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { items, vendedor_id = "Vendedor General", tipo_salida = "venta en pos" } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío" });
    }
    
    // 1. Crear Registro de Salida (precio/total = 0.00 ya que no es venta comercial)
    const { data: sale, error: sErr } = await supabase
      .from("registro_salidas")
      .insert([{ vendedor_id, total: 0.00, tipo_salida }])
      .select();
      
    if (sErr || !sale) throw sErr;
    const saleId = sale[0].id;
    
    // 2. Guardar Detalles y descontar stock
    for (const item of items) {
      await supabase
        .from("registro_salidas_detalles")
        .insert([{
          registro_salida_id: saleId,
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: 0.00
        }]);
        
      let qtyToDeduct = item.cantidad;
      
      // A. Intentar descontar primero de la caja específica seleccionada
      if (item.caja_origen_id) {
        const { data: specificBoxItem } = await supabase
          .from("caja_productos")
          .select("*")
          .eq("id_producto", item.producto_id)
          .eq("id_caja", item.caja_origen_id)
          .maybeSingle();

        if (specificBoxItem) {
          if (specificBoxItem.cantidad <= qtyToDeduct) {
            qtyToDeduct -= specificBoxItem.cantidad;
            // Eliminar relación
            await supabase
              .from("caja_productos")
              .delete()
              .eq("id_relacion", specificBoxItem.id_relacion);
              
            // Actualizar estado de caja a vacía si no queda nada
            const { data: rem } = await supabase
              .from("caja_productos")
              .select("id_relacion")
              .eq("id_caja", specificBoxItem.id_caja);
            if (!rem || rem.length === 0) {
              await supabase.from("cajas").update({ estado: "vacia" }).eq("id_caja", specificBoxItem.id_caja);
            }
          } else {
            await supabase
              .from("caja_productos")
              .update({ cantidad: specificBoxItem.cantidad - qtyToDeduct })
              .eq("id_relacion", specificBoxItem.id_relacion);
            qtyToDeduct = 0;
          }
        }
      }

      // B. Si todavía queda cantidad por descontar (o no se especificó caja), buscar en otras cajas
      if (qtyToDeduct > 0) {
        const { data: boxItems } = await supabase
          .from("caja_productos")
          .select("*")
          .eq("id_producto", item.producto_id)
          .order("cantidad", { ascending: false });
          
        if (boxItems && boxItems.length > 0) {
          for (const boxItem of boxItems) {
            if (qtyToDeduct <= 0) break;
            
            // Ignorar la caja ya procesada
            if (item.caja_origen_id && boxItem.id_caja === item.caja_origen_id) continue;
            
            if (boxItem.cantidad <= qtyToDeduct) {
              qtyToDeduct -= boxItem.cantidad;
              await supabase
                .from("caja_productos")
                .delete()
                .eq("id_relacion", boxItem.id_relacion);
                
              const { data: rem } = await supabase
                .from("caja_productos")
                .select("id_relacion")
                .eq("id_caja", boxItem.id_caja);
              if (!rem || rem.length === 0) {
                await supabase.from("cajas").update({ estado: "vacia" }).eq("id_caja", boxItem.id_caja);
              }
            } else {
              await supabase
                .from("caja_productos")
                .update({ cantidad: boxItem.cantidad - qtyToDeduct })
                .eq("id_relacion", boxItem.id_relacion);
              qtyToDeduct = 0;
            }
          }
        }
      }
      
      // Descontar también en la jerarquía (si hay un nodo asociado al SKU)
      const { data: prod } = await supabase.from("productos").select("sku").eq("id_producto", item.producto_id).single();
      if (prod) {
        const { data: node } = await supabase
          .from("storage_hierarchy")
          .select("*")
          .eq("sku_asociado", prod.sku)
          .maybeSingle();
          
        if (node) {
          const newStock = Math.max(0, node.stock_real - item.cantidad);
          await supabase
            .from("storage_hierarchy")
            .update({ stock_real: newStock })
            .eq("id", node.id);
            
          stockEvents.emit("stock-change", { id: node.id, stock_real: newStock });
        }
      }
    }
    
    res.json({ success: true, saleId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/dashboard/stats - Fetch stats for Alpha Dashboard
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const supabase = getSupabase();

    // 1. Total product models (unique SKUs)
    const { count: totalSKUs, error: skuErr } = await supabase
      .from("productos")
      .select("id_producto", { count: "exact", head: true })
      .eq("activo", true);

    if (skuErr) throw skuErr;

    // 2. Total units in boxes
    const { data: sumData, error: sumErr } = await supabase
      .from("caja_productos")
      .select("cantidad");

    if (sumErr) throw sumErr;
    const totalUnits = (sumData || []).reduce((sum: number, item: any) => sum + (item.cantidad || 0), 0);

    // 3. Boxes by status
    const { data: boxesData, error: boxesErr } = await supabase
      .from("cajas")
      .select("estado");

    if (boxesErr) throw boxesErr;
    const boxStats = {
      total: boxesData?.length || 0,
      vacia: boxesData?.filter((b: any) => b.estado === 'vacia').length || 0,
      activa: boxesData?.filter((b: any) => b.estado === 'activa').length || 0,
      llena: boxesData?.filter((b: any) => b.estado === 'llena').length || 0
    };

    // 4. Warehouse layout elements
    const { count: totalZones } = await supabase.from("zonas_almacen").select("id_zona_almacen", { count: "exact", head: true });
    const { count: totalPasillos } = await supabase.from("zonas_pasillo").select("id_zona_pasillo", { count: "exact", head: true });
    const { count: totalSecciones } = await supabase.from("zonas_seccion").select("id_zona_seccion", { count: "exact", head: true });
    const { count: totalNiveles } = await supabase.from("zonas_nivel").select("id_zona_nivel", { count: "exact", head: true });

    const layoutStats = {
      zonas: totalZones || 0,
      pasillos: totalPasillos || 0,
      secciones: totalSecciones || 0,
      niveles: totalNiveles || 0
    };

    // 5. Recent exits history — using two separate queries to avoid FK join issues
    let recentExits: any[] = [];
    try {
      // 5a. Get recent exits (last 50) — column is "fecha" not "created_at"
      const { data: exits, error: exitsErr } = await supabase
        .from("registro_salidas")
        .select("id, vendedor_id, tipo_salida, fecha")
        .order("fecha", { ascending: false })
        .limit(50);

      if (exitsErr) {
        console.error("Error fetching exits:", exitsErr);
      } else if (exits && exits.length > 0) {
        const exitIds = exits.map((e: any) => e.id);

        // 5b. Get all details for those exits, with product info
        const { data: detailsRaw, error: dErr } = await supabase
          .from("registro_salidas_detalles")
          .select("registro_salida_id, producto_id, cantidad")
          .in("registro_salida_id", exitIds);

        // 5c. Get product info for the referenced products
        let productMap: Record<number, { sku: string; talla: string; marca: string }> = {};
        if (!dErr && detailsRaw && detailsRaw.length > 0) {
          const productIds = [...new Set(detailsRaw.map((d: any) => d.producto_id).filter(Boolean))];
          if (productIds.length > 0) {
            const { data: prods } = await supabase
              .from("productos")
              .select("id_producto, sku, talla, marca_sub")
              .in("id_producto", productIds);
            if (prods) {
              for (const p of prods) {
                productMap[p.id_producto] = { sku: p.sku || "Sin SKU", talla: p.talla || "", marca: p.marca_sub || "" };
              }
            }
          }
        }

        // 5d. Aggregate details by exit
        const detailsByExit: Record<number, any[]> = {};
        if (!dErr && detailsRaw) {
          for (const det of detailsRaw) {
            if (!detailsByExit[det.registro_salida_id]) detailsByExit[det.registro_salida_id] = [];
            const prod = productMap[det.producto_id] || { sku: "Sin SKU", talla: "", marca: "" };
            detailsByExit[det.registro_salida_id].push({
              sku: prod.sku,
              talla: prod.talla,
              marca: prod.marca,
              cantidad: det.cantidad
            });
          }
        }

        // 5e. Build final recentExits array
        recentExits = exits.map((ex: any) => {
          const dets = detailsByExit[ex.id] || [];
          const totalUnidades = dets.reduce((sum: number, d: any) => sum + (d.cantidad || 0), 0);
          return {
            id: ex.id,
            vendedor_id: ex.vendedor_id || "—",
            tipo_salida: ex.tipo_salida || "salida",
            created_at: ex.fecha,   // map 'fecha' → 'created_at' for frontend compatibility
            total_unidades: totalUnidades,
            detalles: dets
          };
        });
      }
    } catch (e) {
      console.error("Failed to fetch exits history:", e);
    }

    // 6. Brand and Type statistics (aggregations)
    const { data: productsData } = await supabase
      .from("productos")
      .select("marca_sub, tipo")
      .eq("activo", true);

    const brandCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    if (productsData) {
      productsData.forEach((p: any) => {
        if (p.marca_sub) brandCounts[p.marca_sub] = (brandCounts[p.marca_sub] || 0) + 1;
        if (p.tipo) typeCounts[p.tipo] = (typeCounts[p.tipo] || 0) + 1;
      });
    }

    // 7. Units by warehouse (almacén) — using vista_total_cajas which resolves
    //    almacen_nombre across ALL hierarchy levels (via nivel, seccion, or direct zone)
    let unitsByAlmacen: Array<{ nombre: string; total: number }> = [];
    try {
      // Fetch all boxes with their resolved almacen_nombre from the view
      const { data: cajasView } = await supabase
        .from("vista_total_cajas")
        .select("id_caja, almacen_nombre");

      // Build a fast lookup map: id_caja → almacen_nombre
      const cajaAlmacenMap: Record<number, string> = {};
      for (const c of (cajasView || [])) {
        cajaAlmacenMap[c.id_caja] = c.almacen_nombre || "Sin Almacén";
      }

      // Fetch all box-product assignments
      const { data: boxProds } = await supabase
        .from("caja_productos")
        .select("id_caja, cantidad");

      // Aggregate by warehouse name
      const almacenMap: Record<string, number> = {};
      for (const item of (boxProds || [])) {
        const nombre = cajaAlmacenMap[item.id_caja] || "Sin Almacén";
        almacenMap[nombre] = (almacenMap[nombre] || 0) + (item.cantidad || 0);
      }

      unitsByAlmacen = Object.entries(almacenMap)
        .map(([nombre, total]) => ({ nombre, total }))
        .sort((a, b) => b.total - a.total);
    } catch (e) {
      console.error("Failed to compute units by almacen:", e);
    }

    res.json({
      totalSKUs: totalSKUs || 0,
      totalUnits,
      boxStats,
      layoutStats,
      recentExits,
      brandCounts,
      typeCounts,
      unitsByAlmacen
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});


// --- FASE 3: INVENTARIO, NOTIFICACIONES Y CARGA ASÍNCRONA ---

// GET /api/inventory/events - List inventory events
app.get("/api/inventory/events", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("inventory_events")
      .select("*")
      .order("fecha", { ascending: false });
      
    if (error) throw error;
    
    // Parse descripcion JSON to extract text + almacenes_ids
    const parsed = (data || []).map((ev: any) => {
      let text = ev.descripcion;
      let almacenesIds: number[] = [];
      try {
        const parsedDesc = JSON.parse(ev.descripcion);
        if (parsedDesc && typeof parsedDesc === "object") {
          text = parsedDesc.text || parsedDesc.descripcion || ev.descripcion;
          almacenesIds = parsedDesc.almacenes_ids || [];
        }
      } catch (_) { /* plain string, keep as-is */ }
      return { ...ev, descripcion: text, almacenes_ids: almacenesIds };
    });
    
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/inventory/events - Create inventory event
app.post("/api/inventory/events", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { descripcion, fecha, almacenes_ids } = req.body;
    
    // Store descripcion + almacenes_ids as JSON
    const descJson = JSON.stringify({
      text: descripcion || "",
      almacenes_ids: Array.isArray(almacenes_ids) ? almacenes_ids.filter((id: any) => typeof id === "number" && id > 0) : []
    });
    
    const { data, error } = await supabase
      .from("inventory_events")
      .insert([{
        descripcion: descJson,
        fecha: fecha ? new Date(fecha) : new Date(),
        estado: "programado"
      }])
      .select();
      
    if (error) throw error;
    
    const ev = data[0];
    emitDomainEvent("inventory:evento", { id: ev.id, estado: ev.estado });
    res.json({ ...ev, descripcion: descripcion || "", almacenes_ids: almacenes_ids || [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/notifications - Fetch manager notifications
app.get("/api/inventory/notifications", (req, res) => {
  res.json(managerNotifications);
});

// GET /api/inventory/notifications/sse - SSE Stream for Manager Notifications
app.get("/api/inventory/notifications/sse", (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);
  
  const listener = (notification: any) => {
    res.write(`data: ${JSON.stringify(notification)}\n\n`);
  };
  
  stockEvents.on("manager-notification", listener);
  
  const pingId = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);
  
  req.on("close", () => {
    stockEvents.off("manager-notification", listener);
    clearInterval(pingId);
  });
});

// POST /api/inventory/count-request - Submit counts from operator
app.post("/api/inventory/count-request", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    // Support both web and mobile app param conventions
    const event_id = req.body.event_id || req.body.inventario_evento_id;
    const operator_id = req.body.operator_id || req.body.operador_id;
    const zone_id = req.body.zone_id || req.body.zona_id;
    const zone_name = req.body.zone_name || req.body.zona_name;
    
    // ── Block duplicate submissions for same zone+event ──────────
    const { data: existing } = await supabase
      .from("count_requests")
      .select("id, estado")
      .eq("zone_id", parseInt(zone_id))
      .eq("event_id", parseInt(event_id))
      .eq("estado", "pendiente")
      .maybeSingle();
    
    if (existing) {
      return res.status(409).json({ 
        error: "Este contenedor/nivel ya fue enviado a revisión y está pendiente de aprobación.",
        existing_request_id: existing.id
      });
    }
    
    let cantidades = req.body.cantidades;
    let eliminaciones = req.body.eliminaciones || [];
    if (!cantidades && req.body.detalles && Array.isArray(req.body.detalles)) {
      cantidades = {};
      const detalleElims: string[] = [];
      for (const item of req.body.detalles) {
        if (item.producto_id !== undefined) {
          const isDelete = item.eliminar === true || item.cantidad_contada === "DELETE";
          if (isDelete) {
            detalleElims.push(String(item.producto_id));
          } else if (item.cantidad_contada !== undefined) {
            cantidades[item.producto_id] = item.cantidad_contada;
          }
        }
      }
      // Merge with top-level eliminaciones (from mobile app)
      for (const e of detalleElims) {
        if (!eliminaciones.includes(e)) eliminaciones.push(e);
      }
    }
    
    if (eliminaciones.length > 0) {
      (cantidades as any).eliminaciones = eliminaciones;
    }
    // Store zone_name inside cantidades JSON since the table may not have a dedicated column
    (cantidades as any).zone_name = zone_name || `Zona ${zone_id}`;
    
    const { data, error } = await supabase
      .from("count_requests")
      .insert([{
        event_id: parseInt(event_id),
        operator_id,
        zone_id: parseInt(zone_id) || null,
        cantidades,
        estado: "pendiente"
      }])
      .select();
      
    if (error) throw error;
    
    // Register notification
    const newNotification = {
      id: Date.now(),
      tipo: "conteo_enviado",
      operator_id,
      zone_name: zone_name || `Zona ${zone_id}`,
      request_id: data[0].id,
      timestamp: new Date().toISOString()
    };
    managerNotifications.push(newNotification);
    stockEvents.emit("manager-notification", newNotification);
    
    // ── Auto-approve if setting enabled ─────────────────────
    const { data: autoApproveSetting } = await supabase
      .from("warehouse_settings")
      .select("valor")
      .eq("clave", "conteo_auto_approve")
      .maybeSingle();
    const autoApprove = autoApproveSetting?.valor === true || autoApproveSetting?.valor === "true";
    
    if (autoApprove && data[0]) {
      const request = data[0];
      const requestId = data[0].id;
      
      // Update count request status to aprobado
      await supabase.from("count_requests").update({ estado: "aprobado" }).eq("id", requestId);
      
      // Process the counts (same logic as /api/inventory/approvals)
      const cantidades = request.cantidades || {};
      const tempSkus = (cantidades as any).temp_skus || {};
      const eliminaciones: string[] = (cantidades as any).eliminaciones || [];
      const zId = request.zone_id;
      
      const { data: box } = await supabase.from("cajas").select("id_caja").eq("id_caja", zId).maybeSingle();
      
      const countRows: any[] = [];
      const boxProductUpserts: any[] = [];
      const boxProductDeletes: { id_caja: number, id_producto: number }[] = [];
      
      for (const [prodIdStr, qty] of Object.entries(cantidades)) {
        if (prodIdStr === "temp_skus" || prodIdStr === "eliminaciones") continue;
        let prodId = parseInt(prodIdStr);
        const quantity = parseInt(qty as any);
        
        if (prodId < 0) {
          const tempSku = tempSkus[prodIdStr];
          if (tempSku) {
            const { data: existingProd } = await supabase.from("productos").select("id_producto").eq("sku", tempSku).maybeSingle();
            if (!existingProd) {
              const { data: newProd } = await supabase.from("productos").insert([{
                sku: tempSku, talla: "UNICA", temporada: "todouso", tipo: "nivel", marca_sub: "TEMPORAL", activo: true
              }]).select("id_producto").single();
              prodId = newProd.id_producto;
            } else {
              prodId = existingProd.id_producto;
            }
          } else { continue; }
        }
        
        countRows.push({ event_id: request.event_id, producto_id: prodId, zona_id: zId, cantidad_final: quantity });
        if (box) {
          if (quantity === 0) {
            boxProductDeletes.push({ id_caja: zId, id_producto: prodId });
          } else {
            boxProductUpserts.push({ id_caja: zId, id_producto: prodId, cantidad: quantity });
          }
        }
      }
      
      if (countRows.length > 0) await supabase.from("counts").insert(countRows);
      for (const del of boxProductDeletes) await supabase.from("caja_productos").delete().eq("id_caja", del.id_caja).eq("id_producto", del.id_producto);
      if (boxProductUpserts.length > 0) await supabase.from("caja_productos").upsert(boxProductUpserts, { onConflict: "id_caja,id_producto" });
      
      for (const prodIdStr of eliminaciones) {
        const elimProdId = parseInt(prodIdStr);
        if (isNaN(elimProdId)) continue;
        await supabase.from("caja_productos").delete().eq("id_caja", zId).eq("id_producto", elimProdId);
        await supabase.from("productos").delete().eq("id_producto", elimProdId);
        await supabase.from("counts").insert([{ event_id: request.event_id, producto_id: elimProdId, zona_id: zId, cantidad_final: 0 }]);
      }
      
      // Update box state
      const { data: remainingProds } = await supabase.from("caja_productos").select("cantidad").eq("id_caja", zId);
      const totalUnits = (remainingProds || []).reduce((sum: number, p: any) => sum + (p.cantidad || 0), 0);
      await supabase.from("cajas").update({ estado: totalUnits > 0 ? "activa" : "vacia" }).eq("id_caja", zId);
      
      res.json({ ...data[0], autoApproved: true });
      return;
    }
    
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/inventory/operator-active - Notification when operator enters a zone
app.post("/api/inventory/operator-active", (req, res) => {
  const { operator_id, zone_name } = req.body;
  const newNotification = {
    id: Date.now(),
    tipo: "operador_activo",
    operator_id,
    zone_name,
    timestamp: new Date().toISOString()
  };
  managerNotifications.push(newNotification);
  stockEvents.emit("manager-notification", newNotification);
  res.json({ success: true });
});

// GET /api/inventory/auto-approve - Get auto-approve setting for count requests
app.get("/api/inventory/auto-approve", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("warehouse_settings")
      .select("valor")
      .eq("clave", "conteo_auto_approve")
      .maybeSingle();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ autoApprove: data?.valor === true || data?.valor === "true" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/inventory/auto-approve - Toggle auto-approve setting
app.put("/api/inventory/auto-approve", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { autoApprove } = req.body;
    const enabled = autoApprove === true || autoApprove === "true";
    const { data, error } = await supabase
      .from("warehouse_settings")
      .upsert({ clave: "conteo_auto_approve", valor: enabled }, { onConflict: "clave" })
      .select();
    if (error) throw error;
    res.json({ autoApprove: enabled });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/count-requests - List all count requests with enriched data
app.get("/api/inventory/count-requests", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("count_requests")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    
    // Enrich with zone names and product SKUs
    const enriched = [];
    for (const req of data || []) {
      const cantidadesZoneName = (req.cantidades as any)?.zone_name || "";
      const enrichedReq = { ...req, zone_name_display: cantidadesZoneName || `Zona ${req.zone_id}` };
      
      // Resolve box/caja/nivel/seccion name if not available from cantidades
      if (!cantidadesZoneName && req.zone_id) {
        // Try cajas first
        let { data: caja } = await supabase
          .from("cajas")
          .select("numero_caja, almacen_nombre, seccion_nombre, pasillo_nombre")
          .eq("id_caja", req.zone_id)
          .maybeSingle();
        if (caja) {
          enrichedReq.zone_name_display = `${caja.numero_caja} (${caja.almacen_nombre || "Sin almacén"}${caja.pasillo_nombre ? " | " + caja.pasillo_nombre : ""}${caja.seccion_nombre ? " | " + caja.seccion_nombre : ""})`;
        } else {
          // Try niveles
          const { data: nivel } = await supabase
            .from("zonas_niveles")
            .select("nombre, almacen_nombre, pasillo_nombre, seccion_nombre")
            .eq("id_zona_nivel", req.zone_id)
            .maybeSingle();
          if (nivel) {
            enrichedReq.zone_name_display = `Nivel ${nivel.nombre} (${nivel.almacen_nombre || "Sin almacén"}${nivel.pasillo_nombre ? " | " + nivel.pasillo_nombre : ""}${nivel.seccion_nombre ? " | " + nivel.seccion_nombre : ""})`;
          } else {
            // Try secciones
            const { data: seccion } = await supabase
              .from("zonas_secciones")
              .select("nombre, almacen_nombre, pasillo_nombre")
              .eq("id_zona_seccion", req.zone_id)
              .maybeSingle();
            if (seccion) {
              enrichedReq.zone_name_display = `Sección ${seccion.nombre} (${seccion.almacen_nombre || "Sin almacén"}${seccion.pasillo_nombre ? " | " + seccion.pasillo_nombre : ""})`;
            } else {
              enrichedReq.zone_name_display = `Zona ${req.zone_id}`;
            }
          }
        }
      }
      
      // Resolve product SKUs from cantidades
      const productIds: number[] = [];
      const cantidades = req.cantidades || {};
      for (const key of Object.keys(cantidades)) {
        if (key !== "temp_skus" && key !== "eliminaciones") {
          const pid = parseInt(key);
          if (!isNaN(pid) && pid > 0) productIds.push(pid);
        }
      }
      
      if (productIds.length > 0) {
        const { data: productos } = await supabase
          .from("productos")
          .select("id_producto, sku, ean_13, talla, tipo, marca_sub, modelo_grupo")
          .in("id_producto", productIds);
        
        if (productos) {
          (enrichedReq as any).productos_map = {};
          for (const p of productos) {
            (enrichedReq as any).productos_map[p.id_producto] = p;
          }
        }
      }
      
      enriched.push(enrichedReq);
    }
    
    res.json(enriched);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/pending-summary?event_id=X — Box/level status for counting workflow
app.get("/api/inventory/pending-summary", async (req, res) => {
  try {
    const supabase = getSupabase();
    const eventId = parseInt(req.query.event_id as string);
    if (isNaN(eventId)) return res.status(400).json({ error: "event_id requerido" });

    // Fetch event to get almacenes_ids filter
    const { data: eventData } = await supabase
      .from("inventory_events")
      .select("descripcion")
      .eq("id", eventId)
      .maybeSingle();

    let almacenesIds: number[] = [];
    if (eventData?.descripcion) {
      try {
        const parsed = JSON.parse(eventData.descripcion);
        if (Array.isArray(parsed.almacenes_ids)) {
          almacenesIds = parsed.almacenes_ids.filter((id: any) => typeof id === "number" && id > 0);
        }
      } catch (_) { /* plain string, no filter */ }
    }

    // Get count requests for this event → zone_id status map
    const { data: requests } = await supabase
      .from("count_requests")
      .select("zone_id, estado")
      .eq("event_id", eventId);

    const zoneStatus: Record<number, string> = {};
    for (const r of (requests || [])) {
      if (r.estado === "pendiente") zoneStatus[r.zone_id] = "revision";
      else if (r.estado === "aprobado") zoneStatus[r.zone_id] = "contado";
    }

    // Fetch basic data: secciones, almacenes, pasillos, niveles, cajas
    const [
      { data: rawSecciones }, { data: rawAlmacenes }, { data: rawPasillos },
      { data: rawNiveles }, { data: rawCajas }
    ] = await Promise.all([
      supabase.from("zonas_seccion").select("id_zona_seccion, nombre, id_zona_almacen, id_zona_pasillo"),
      supabase.from("zonas_almacen").select("id_zona_almacen, nombre"),
      supabase.from("zonas_pasillo").select("id_zona_pasillo, nombre, id_zona_almacen"),
      supabase.from("zonas_nivel").select("id_zona_nivel, nombre, id_zona_seccion"),
      supabase.from("cajas").select("id_caja, numero_caja, id_zona_almacen, id_zona_seccion, id_zona_nivel, estado")
    ]);

    // Build lookup maps
    const almacenNombreMap = new Map<number, string>((rawAlmacenes || []).map((a: any) => [a.id_zona_almacen, a.nombre]));
    const pasilloMap = new Map<number, any>((rawPasillos || []).map((p: any) => [p.id_zona_pasillo, p]));

    // Resolve each seccion's almacen_id (direct or via pasillo) and names
    const seccionAlmacenId = new Map<number, number>();  // seccion_id → almacen_id
    const seccionAlmacenNombre = new Map<number, string>();
    const seccionPasilloNombre = new Map<number, string>();
    const seccionNombre = new Map<number, string>();

    for (const s of (rawSecciones || [])) {
      const almId = s.id_zona_almacen
        || (pasilloMap.get(s.id_zona_pasillo)?.id_zona_almacen)
        || 0;
      seccionAlmacenId.set(s.id_zona_seccion, almId);
      seccionNombre.set(s.id_zona_seccion, s.nombre || "");
      seccionAlmacenNombre.set(s.id_zona_seccion, almacenNombreMap.get(almId) || "");
      const pasillo = pasilloMap.get(s.id_zona_pasillo);
      seccionPasilloNombre.set(s.id_zona_seccion, pasillo?.nombre || "");
    }

    // Build items
    const items: any[] = [];

    for (const c of (rawCajas || [])) {
      if (c.numero_caja?.toUpperCase().startsWith("NIVEL:")) continue;

      // Check if this caja belongs to any of the selected almacenes
      if (almacenesIds.length > 0) {
        const cajaAlmId = c.id_zona_almacen || seccionAlmacenId.get(c.id_zona_seccion) || 0;
        const matchesAlmacen = almacenesIds.includes(cajaAlmId);
        const matchesSeccion = c.id_zona_seccion && almacenesIds.some((aid: number) => seccionAlmacenId.get(c.id_zona_seccion) === aid);
        const matchesNivel = c.id_zona_nivel && rawNiveles?.some((n: any) => n.id_zona_nivel === c.id_zona_nivel
          && almacenesIds.includes(seccionAlmacenId.get(n.id_zona_seccion) || 0));
        if (!matchesAlmacen && !matchesSeccion && !matchesNivel) continue;
      }

      let almacenNom = seccionAlmacenNombre.get(c.id_zona_seccion) || "";
      let seccionNom = seccionNombre.get(c.id_zona_seccion) || "";
      let pasilloNom = seccionPasilloNombre.get(c.id_zona_seccion) || "";

      const ws = zoneStatus[c.id_caja];
      items.push({
        type: "cajas", id: c.id_caja, name: c.numero_caja,
        almacen: almacenNom, seccion: seccionNom, pasillo: pasilloNom,
        status: ws || "pendiente"
      });
    }

    for (const n of (rawNiveles || [])) {
      // Check if this nivel belongs to any of the selected almacenes
      if (almacenesIds.length > 0) {
        const nivelAlmId = seccionAlmacenId.get(n.id_zona_seccion) || 0;
        if (!almacenesIds.includes(nivelAlmId)) continue;
      }

      const ws = zoneStatus[n.id_zona_nivel];
      items.push({
        type: "niveles", id: n.id_zona_nivel, name: n.nombre,
        almacen: seccionAlmacenNombre.get(n.id_zona_seccion) || "",
        seccion: seccionNombre.get(n.id_zona_seccion) || "",
        pasillo: seccionPasilloNombre.get(n.id_zona_seccion) || "",
        status: ws || "pendiente"
      });
    }

    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/pending-debug - Debug endpoint for pending summaries
app.get("/api/inventory/pending-debug", async (req, res) => {
  try {
    const supabase = getSupabase();
    const eventId = parseInt(req.query.event_id as string);
    if (isNaN(eventId)) return res.status(400).json({ error: "event_id requerido" });

    const { data: eventData } = await supabase.from("inventory_events").select("descripcion").eq("id", eventId).maybeSingle();
    let almacenesIds: number[] = [];
    if (eventData?.descripcion) {
      try { const p = JSON.parse(eventData.descripcion); if (Array.isArray(p.almacenes_ids)) almacenesIds = p.almacenes_ids; } catch (_) {}
    }

    const [{ data: secciones }, { data: almacenes }, { data: pasillos }, { data: niveles }, { data: cajas }] = await Promise.all([
      supabase.from("zonas_seccion").select("id_zona_seccion, id_zona_almacen, id_zona_pasillo"),
      supabase.from("zonas_almacen").select("id_zona_almacen, nombre"),
      supabase.from("zonas_pasillo").select("id_zona_pasillo, nombre, id_zona_almacen"),
      supabase.from("zonas_nivel").select("id_zona_nivel, id_zona_seccion"),
      supabase.from("cajas").select("id_caja, id_zona_almacen, id_zona_seccion, id_zona_nivel").not("numero_caja", "ilike", "NIVEL:%")
    ]);

    const pasilloMap = new Map<number, any>((pasillos || []).map((p: any) => [p.id_zona_pasillo, p]));
    const seccionAlmacenId = new Map<number, number>((secciones || []).map((s: any) => {
      const almId = s.id_zona_almacen || pasilloMap.get(s.id_zona_pasillo)?.id_zona_almacen || 0;
      return [s.id_zona_seccion, almId] as [number, number];
    }));

    const debug: any = {
      event_id: eventId,
      almacenes_ids: almacenesIds,
      total_secciones: secciones?.length || 0,
      total_almacenes: almacenes?.length || 0,
      total_niveles: niveles?.length || 0,
      total_cajas: cajas?.length || 0,
      secciones_con_almacen: [...new Set([...seccionAlmacenId.values()].filter(v => v > 0))],
    };

    // Check how many cajas pass the filter
    if (almacenesIds.length > 0) {
      let matchAlmacen = 0, matchSeccion = 0, matchNivel = 0, noMatch = 0;
      for (const c of (cajas || [])) {
        const cajaAlmId = c.id_zona_almacen || seccionAlmacenId.get(c.id_zona_seccion) || 0;
        if (almacenesIds.includes(cajaAlmId)) { matchAlmacen++; continue; }
        if (c.id_zona_seccion && almacenesIds.some((a: number) => seccionAlmacenId.get(c.id_zona_seccion) === a)) { matchSeccion++; continue; }
        if (c.id_zona_nivel && niveles?.some((n: any) => n.id_zona_nivel === c.id_zona_nivel && almacenesIds.includes(seccionAlmacenId.get(n.id_zona_seccion) || 0))) { matchNivel++; continue; }
        noMatch++;
      }
      debug.cajas_match_almacen = matchAlmacen;
      debug.cajas_match_seccion = matchSeccion;
      debug.cajas_match_nivel = matchNivel;
      debug.cajas_no_match = noMatch;
    }

    res.json(debug);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cajas/:id — Remove box and its product associations (keeps products)
app.delete("/api/cajas/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const boxId = parseInt(req.params.id);
    if (isNaN(boxId)) return res.status(400).json({ error: "ID inválido" });
    
    // Delete product associations first
    await supabase.from("caja_productos").delete().eq("id_caja", boxId);
    // Delete the box itself
    const { error } = await supabase.from("cajas").delete().eq("id_caja", boxId);
    if (error) throw error;
    
    emitDomainEvent("caja:deleted", { id_caja: boxId });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/inventory/approvals - Manager approves/rejects counts
app.post("/api/inventory/approvals", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { request_id, manager_id, status, comentarios } = req.body;
    
    // 1. Save approval record
    const { data: approval, error: aErr } = await supabase
      .from("approvals")
      .insert([{ request_id, manager_id, status, comentarios }])
      .select();
      
    if (aErr) throw aErr;
    
    // 2. Update count request status
    const { data: request } = await supabase
      .from("count_requests")
      .update({ estado: status })
      .eq("id", request_id)
      .select()
      .single();

    // 3. Avisar por SSE al operario (aprobación/rechazo en tiempo real)
    emitDomainEvent("inventory:approved", { request_id, estado: status, zone_id: request?.zone_id, event_id: request?.event_id });
      
    if (status === "aprobado" && request) {
      const cantidades = request.cantidades || {};
      const tempSkus = cantidades.temp_skus || {};
      const eliminaciones: string[] = cantidades.eliminaciones || [];
      const event_id = request.event_id;
      const zone_id = request.zone_id;
      
      // Pre-check: is this a valid box? (once, not per product)
      const { data: box } = await supabase.from("cajas").select("id_caja").eq("id_caja", zone_id).maybeSingle();
      
      const countRows: any[] = [];
      const boxProductUpserts: any[] = [];
      const boxProductDeletes: { id_caja: number, id_producto: number }[] = [];
      
      for (const [prodIdStr, qty] of Object.entries(cantidades)) {
        if (prodIdStr === "temp_skus" || prodIdStr === "eliminaciones") continue;
        let prodId = parseInt(prodIdStr);
        const quantity = parseInt(qty as any);
        
        if (prodId < 0) {
          const tempSku = tempSkus[prodIdStr];
          if (tempSku) {
            const { data: existingProd } = await supabase
              .from("productos")
              .select("id_producto")
              .eq("sku", tempSku)
              .maybeSingle();
              
            if (!existingProd) {
              const { data: newProd, error: pErr } = await supabase
                .from("productos")
                .insert([{
                  sku: tempSku,
                  talla: "UNICA",
                  temporada: "todouso",
                  tipo: "nivel",
                  marca_sub: "TEMPORAL",
                  activo: true
                }])
                .select("id_producto")
                .single();
              if (pErr) throw pErr;
              prodId = newProd.id_producto;
            } else {
              prodId = existingProd.id_producto;
            }
          } else {
            continue;
          }
        }
        
        countRows.push({
          event_id,
          producto_id: prodId,
          zona_id: zone_id,
          cantidad_final: quantity
        });
        
        if (box) {
          if (quantity === 0) {
            boxProductDeletes.push({ id_caja: zone_id, id_producto: prodId });
          } else {
            boxProductUpserts.push({ id_caja: zone_id, id_producto: prodId, cantidad: quantity });
          }
        }
      }
      
      // ── Batch execute all DB operations ─────────────────────
      if (countRows.length > 0) {
        await supabase.from("counts").insert(countRows);
      }
      for (const del of boxProductDeletes) {
        await supabase.from("caja_productos").delete().eq("id_caja", del.id_caja).eq("id_producto", del.id_producto);
      }
      if (boxProductUpserts.length > 0) {
        await supabase.from("caja_productos").upsert(boxProductUpserts, { onConflict: "id_caja,id_producto" });
      }
      
      // Handle elimination requests (delete products entirely from system)
      for (const prodIdStr of eliminaciones) {
        const elimProdId = parseInt(prodIdStr);
        if (isNaN(elimProdId)) continue;
        
        await supabase.from("caja_productos").delete().eq("id_caja", zone_id).eq("id_producto", elimProdId);
        await supabase.from("productos").delete().eq("id_producto", elimProdId);
        
        await supabase
          .from("counts")
          .insert([{
            event_id,
            producto_id: elimProdId,
            zona_id: zone_id,
            cantidad_final: 0
          }]);
          
        emitDomainEvent("producto:deleted", {
          id_producto: elimProdId,
          zone_id: zone_id
        });
      }
      
      // Update actual box/level state based on total remaining units inside it
      const { data: remainingProds } = await supabase
        .from("caja_productos")
        .select("cantidad")
        .eq("id_caja", zone_id);
        
      const totalUnits = (remainingProds || []).reduce((sum: number, p: any) => sum + (p.cantidad || 0), 0);
      const newBoxState = totalUnits > 0 ? "activa" : "vacia";
      
      await supabase
        .from("cajas")
        .update({ estado: newBoxState })
        .eq("id_caja", zone_id);
        
      emitDomainEvent("caja:updated", {
        action: "update",
        id_caja: zone_id
      });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/inventory/events/:id/finalizar - Manually finalize inventory event
app.post("/api/inventory/events/:id/finalizar", async (req, res) => {
  try {
    const supabase = getSupabase();
    const eventId = parseInt(req.params.id);
    
    const { data, error } = await supabase
      .from("inventory_events")
      .update({ estado: "completado" })
      .eq("id", eventId)
      .select();
      
    if (error) throw error;
    
    // Broadcast notification to active operators that the event has ended
    const newNotification = {
      id: Date.now(),
      tipo: "evento_finalizado",
      event_id: eventId,
      timestamp: new Date().toISOString()
    };
    stockEvents.emit("manager-notification", newNotification);
    emitDomainEvent("inventory:finalizado", { id: eventId, estado: "completado" });
    
    res.json(data[0] || { success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/inventory/reports - Compile final consolidated report
app.get("/api/inventory/reports", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("counts")
      .select(`
        id,
        event_id,
        producto_id,
        zona_id,
        cantidad_final,
        created_at,
        productos (
          id_producto,
          sku,
          ean_13,
          talla,
          tipo,
          marca_sub
        )
      `)
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/inventory/reports - Clear all finalized reports
app.delete("/api/inventory/reports", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("counts").delete().neq("id", 0);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ocr/save-training - Guardar sample de entrenamiento OCR
// Recibe imagen original + preprocesada en base64, resultado ML Kit, y metadata.
// Si incluye user_truth (dato confirmado por el usuario), se guarda ya verificado.
// Almacena en Supabase para entrenamiento futuro de PaddleOCR.
app.post("/api/ocr/save-training", async (req, res) => {
  try {
    // Service role: el servidor es el único escritor (bypassa RLS de anon)
    const supabase = getSupabaseService();
    const {
      image_original,
      image_preprocessed,
      mlkit_result,
      barcode,
      image_width,
      image_height,
      preprocessing_time_ms,
      device_info,
      user_truth
    } = req.body;

    if (!image_original || !mlkit_result) {
      return res.status(400).json({ error: "Faltan campos requeridos: image_original, mlkit_result" });
    }

    // Guardar en tabla ocr_training_data
    const modelo = mlkit_result?.modelo_grupo || "";
    const categoria = categorizeLabel(modelo);
    const confirmed = user_truth && typeof user_truth === 'object' ? user_truth : null;

    const baseRow: any = {
      image_original: image_original,
      image_preprocessed: image_preprocessed || null,
      mlkit_result: mlkit_result,
      barcode: barcode || null,
      modelo_grupo: modelo || null,
      categoria: categoria,
      image_width: image_width || null,
      image_height: image_height || null,
      preprocessing_time_ms: preprocessing_time_ms || null,
      device_info: device_info || null,
      // Verdad absoluta del usuario cuando viene confirmada en el mismo guardado
      user_truth: confirmed,
      verified_by: confirmed ? 'usuario' : null,
      is_verified: !!confirmed,
      verified_at: confirmed ? new Date().toISOString() : null,
      created_at: new Date().toISOString()
    };

    let { data, error } = await supabase
      .from('ocr_training_data')
      .insert(baseRow)
      .select('id')
      .single();

    // Fallback pre-migración 20260818: reintentar sin columnas nuevas
    if (error && /user_truth|verified_by/.test(error.message || "")) {
      delete baseRow.user_truth;
      delete baseRow.verified_by;
      const retry = await supabase.from('ocr_training_data').insert(baseRow).select('id').single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error("Error guardando training sample:", error.message);
      // Si la tabla no existe, devolver success silencioso (no romper el flujo)
      if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
        return res.status(200).json({ saved: false, reason: "Tabla ocr_training_data no existe aún" });
      }
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ saved: true, id: data?.id });
  } catch (error: any) {
    console.error("Error en save-training:", error.message?.slice(0, 200));
    res.status(500).json({ error: error.message || "Error al guardar training sample" });
  }
});

// GET /api/ocr/training-stats - Estadísticas del dataset de entrenamiento
// ready_for_training = verificados con ground truth del usuario (user_truth)
app.get("/api/ocr/training-stats", async (req, res) => {
  try {
    // Service role: lectura interna del dataset (RLS de anon lo bloquea)
    const supabase = getSupabaseService();

    let data: any[] | null = null;
    try {
      const r = await supabase
        .from('ocr_training_data')
        .select('id, is_verified, matches_mlkit, barcode, created_at, user_truth, verified_by');
      if (r.error) throw r.error;
      data = r.data;
    } catch {
      // Fallback pre-migración 20260818
      const r = await supabase
        .from('ocr_training_data')
        .select('id, is_verified, matches_mlkit, barcode, created_at');
      if (r.error) {
        if (r.error.message?.includes('relation') || r.error.message?.includes('does not exist')) {
          return res.status(200).json({
            total_samples: 0,
            verified_samples: 0,
            pending_verification: 0,
            mlkit_correct: 0,
            mlkit_incorrect: 0,
            mlkit_accuracy_pct: 0,
            unique_barcodes: 0,
            first_sample: null,
            last_sample: null
          });
        }
        return res.status(500).json({ error: r.error.message });
      }
      data = (r.data || []).map((x: any) => ({ ...x, user_truth: null, verified_by: null }));
    }

    const total = data?.length || 0;
    const verified = data?.filter(r => r.is_verified).length || 0;
    const pending = total - verified;
    const mlkitCorrect = data?.filter(r => r.matches_mlkit === true).length || 0;
    const mlkitIncorrect = data?.filter(r => r.matches_mlkit === false).length || 0;
    const accuracy = verified > 0 ? Math.round(100.0 * mlkitCorrect / verified * 10) / 10 : 0;
    // Ground truth usable para entrenar: solo user_truth (verdad absoluta del usuario)
    const readyForTraining = data?.filter(r => r.is_verified && r.user_truth != null).length || 0;
    const userVerified = data?.filter(r => r.is_verified && r.verified_by === 'usuario').length || 0;
    // Fallback de solo lectura: filas legacy con groq_truth sin migrar a user_truth.
    // No cuentan para entrenar. Se eliminan con la migración DROP pendiente.
    let legacyGroqRows = 0;
    try {
      const lg = await supabase
        .from('ocr_training_data')
        .select('id')
        .not('groq_truth', 'is', null)
        .is('user_truth', null)
        .limit(5000);
      if (!lg.error && lg.data) {
        legacyGroqRows = lg.data.length;
        if (legacyGroqRows > 0) {
          console.warn(`[OCR] ${legacyGroqRows} samples legacy con groq_truth sin user_truth (aplicar migración DROP cuando se validen)`);
        }
      }
    } catch { /* columna groq_truth ya dropeada: nada que advertir */ }
    const uniqueBarcodes = new Set(data?.filter(r => r.barcode).map(r => r.barcode)).size;
    const dates = data?.map(r => r.created_at).filter(Boolean).sort();

    // Estadísticas por categoría
    const byCategory: Record<string, { total: number; verified: number; correct: number }> = {};
    data?.forEach(r => {
      const cat = r.categoria || "sin_categoria";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, verified: 0, correct: 0 };
      byCategory[cat].total++;
      if (r.is_verified) {
        byCategory[cat].verified++;
        if (r.matches_mlkit === true) byCategory[cat].correct++;
      }
    });

    res.status(200).json({
      total_samples: total,
      verified_samples: verified,
      pending_verification: pending,
      mlkit_correct: mlkitCorrect,
      mlkit_incorrect: mlkitIncorrect,
      mlkit_accuracy_pct: accuracy,
      ready_for_training: readyForTraining,
      user_verified: userVerified,
      legacy_groq_rows: legacyGroqRows,
      training_job: ocrTrainingJob.status,
      unique_barcodes: uniqueBarcodes,
      first_sample: dates?.[0] || null,
      last_sample: dates?.[dates.length - 1] || null,
      by_category: byCategory
    });
  } catch (error: any) {
    console.error("Error en training-stats:", error.message?.slice(0, 200));
    res.status(500).json({ error: error.message || "Error al obtener stats" });
  }
});

// ─── Categorización de etiquetas por prefijo ──────────────────
function categorizeLabel(modelo: string): string {
  const m = modelo.trim().toUpperCase();
  if (!m || m.length < 2) return "desconocido";

  const first = m.charAt(0);
  const second = m.length > 1 ? m.charAt(1) : "";
  const isDigit = (c: string) => c >= '0' && c <= '9';

  // GW = Calzado Mujer, GM = Calzado Hombre
  if (first === 'G' && second) {
    if (second === 'W') return "calzado_mujer";
    if (second === 'M') return "calzado_hombre";
  }

  // W = Ropa Mujer
  if (first === 'W' && isDigit(second)) return "ropa_mujer";

  // M = Ropa Hombre
  if (first === 'M' && isDigit(second)) return "ropa_hombre";

  // 3/4/5/6 = Marciano
  if (isDigit(first) && (first === '3' || first === '4' || first === '5' || first === '6')) {
    return "marciano";
  }

  // ESG/SSG = Bolsas/Mochilas
  if (m.startsWith("ESG") || m.startsWith("SSG")) return "bolsas";

  // PD/GWJR = Calzado descripción
  if (m.startsWith("PD") || m.startsWith("GWJR") || m.startsWith("GMJR")) return "calzado_etiqueta";

  // Default
  if (first === 'G') return "calzado";
  if (isDigit(first)) return "marciano";
  return "general";
}

// POST /api/ocr/save-correction - Guardar corrección del usuario como ground truth
// El dato confirmado/corregido por el usuario es VERDAD ABSOLUTA para entrenar PaddleOCR.
// Sin IA externa en este flujo.
// Actualiza la fila del escaneo (una fila por scan: mlkit_result + user_truth),
// en vez de insertar una fila sin imagen (image_original es NOT NULL).
app.post("/api/ocr/save-correction", async (req, res) => {
  try {
    // Service role: el servidor es el único escritor (bypassa RLS de anon)
    const supabase = getSupabaseService();
    const { barcode, mlkit_result, corrected_result, modelo_grupo } = req.body;

    if (!barcode || !corrected_result) {
      return res.status(400).json({ error: "barcode y corrected_result requeridos" });
    }

    // Categorizar por prefijo de modelo
    const modelo = modelo_grupo || corrected_result.modelo_grupo || "";
    const categoria = categorizeLabel(modelo);
    const mlkit = mlkit_result || {};
    // Si el usuario confirmó sin cambios, ML Kit estaba en lo correcto
    const matchesMlkit = (
      (mlkit.modelo_grupo || "").toUpperCase() === (corrected_result.modelo_grupo || "").toUpperCase() &&
      (mlkit.talla || "").toUpperCase() === (corrected_result.talla || "").toUpperCase()
    );

    const truthPatch: any = {
      user_truth: corrected_result, // verdad absoluta del usuario
      verified_by: "usuario",
      is_verified: true,
      verified_at: new Date().toISOString(),
      matches_mlkit: matchesMlkit,
      modelo_grupo: modelo,
      categoria: categoria,
      device_info: "user-correction"
    };

    // 1. Buscar la fila del escaneo aún sin verificar (la más reciente de ese barcode)
    const { data: existing } = await supabase
      .from('ocr_training_data')
      .select('id')
      .eq('barcode', barcode)
      .eq('is_verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('ocr_training_data')
        .update(truthPatch)
        .eq('id', existing.id);
      if (error) {
        console.error("Error actualizando corrección:", error.message);
        return res.status(200).json({ saved: false, reason: error.message });
      }
      return res.status(200).json({ saved: true, categoria, updated: true });
    }

    // 2. Sin fila previa: insertar (requiere imagen; sin ella la fila es inútil para entrenar)
    return res.status(200).json({
      saved: false,
      reason: "No hay sample sin verificar para ese barcode. Escanea primero la etiqueta."
    });
  } catch (error: any) {
    console.error("Error en save-correction:", error.message?.slice(0, 200));
    res.status(500).json({ error: error.message });
  }
});
// Estado del job de entrenamiento PaddleOCR (ver declaración top-of-file: ocrTrainingJob).
// start-training lo actualiza; la app lo consulta con polling.
// GET /api/ocr/training-status - Progreso del entrenamiento en curso o último ejecutado
app.get("/api/ocr/training-status", requireManager, async (req, res) => {
  try {
    const fsp = require('fs/promises');
    const TAIL_BYTES = 40 * 1024; // lee solo los últimos 40KB, nunca el archivo completo
    let log_tail: string[] = [];
    const logFile: string | null = ocrTrainingJob.log_file;
    if (logFile) {
      try {
        const fh = await fsp.open(logFile, 'r');
        try {
          const stat = await fh.stat();
          const start = Math.max(0, stat.size - TAIL_BYTES);
          const len = Math.min(stat.size, TAIL_BYTES);
          const buf = Buffer.alloc(len);
          if (len > 0) await fh.read(buf, 0, len, start);
          const lines = buf.toString("utf-8").split("\n");
          // Si se truncó, la primera línea puede estar cortada → se descarta
          const usable = start > 0 ? lines.slice(1) : lines;
          log_tail = usable.filter((l: string) => l.trim().length > 0).slice(-40);
        } finally {
          await fh.close();
        }
      } catch { /* log aún no existe o sin permiso: tail vacío */ }
    }
    res.status(200).json({ ...ocrTrainingJob, log_tail });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// Ejecuta el script Python de training en el servidor.
// El dataset es el ground truth del usuario (user_truth): ML Kit + confirmación/corrección.
// Progreso visible vía GET /api/ocr/training-status (state + cola del log).
app.post("/api/ocr/start-training", requireManager, async (req, res) => {
  try {
    if (ocrTrainingJob.status === "running") {
      return res.status(200).json({
        started: false,
        message: "Ya hay un entrenamiento en curso. Consulta /api/ocr/training-status.",
      });
    }

    // 0. Verificar script ANTES de cambiar el estado a running
    const scriptPath = './scripts/train_paddle_ocr.py';
    const fs = require('fs');
    if (!fs.existsSync(scriptPath)) {
      return res.status(200).json({
        started: false,
        message: "Script de training no encontrado. Verifica scripts/train_paddle_ocr.py",
        verified_count: 0
      });
    }

    // Conteo interno con service_role (bypassa RLS); la anon key puede no ver las filas
    const supabase = getSupabaseService();

    // 1. Verificar que hay suficientes datos con ground truth del usuario
    let verifiedRows: any[] | null = null;
    try {
      const r = await supabase
        .from('ocr_training_data')
        .select('id, user_truth')
        .eq('is_verified', true)
        .limit(5000);
      if (r.error) throw r.error;
      verifiedRows = r.data;
    } catch (e: any) {
      return res.status(500).json({ error: e?.message || "Error al contar datos verificados" });
    }
    const count = (verifiedRows || []).filter((x: any) => x.user_truth != null).length;

    if (count < 50) {
      return res.status(200).json({
        started: false,
        message: `Insuficientes datos verificados (${count}/50 mínimo). Confirma o corrige detecciones en Lote para crear ground truth.`,
        verified_count: count
      });
    }

    // 2. Ejecutar training script en background con log a disco
    const { spawn } = require('child_process');
    const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';

    if (!fs.existsSync('./training_output')) {
      fs.mkdirSync('./training_output', { recursive: true });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = `./training_output/train_${ts}.log`;
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    logStream.write(`[${new Date().toISOString()}] Training iniciado con ${count} samples (ground truth usuario)\n`);

    ocrTrainingJob.status = "running";
    ocrTrainingJob.started_at = new Date().toISOString();
    ocrTrainingJob.finished_at = null;
    ocrTrainingJob.exit_code = null;
    ocrTrainingJob.verified_count = count;
    ocrTrainingJob.log_file = logFile;
    ocrTrainingJob.message = `Training en curso con ${count} samples verificados`;

    const child = spawn(PYTHON_BIN, [
      scriptPath,
      '--supabase-url', process.env.SUPABASE_URL || '',
      '--supabase-key', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
      '--output-dir', './training_output'
    ], {
      env: {
        ...process.env,
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''
      }
    });
    child.stdout.on('data', (d: any) => logStream.write(d));
    child.stderr.on('data', (d: any) => logStream.write(`[STDERR] ${d}`));
    child.on('error', (err: any) => {
      logStream.write(`[SPAWN ERROR] ${err.message}\n`);
      logStream.end();
      ocrTrainingJob.status = "error";
      ocrTrainingJob.finished_at = new Date().toISOString();
      ocrTrainingJob.exit_code = -1;
      ocrTrainingJob.message = `No se pudo ejecutar python: ${err.message}`;
      console.error("Training spawn error:", err.message);
    });
    child.on('close', (code: number) => {
      logStream.write(`[${new Date().toISOString()}] Proceso terminado con código ${code}\n`);
      logStream.end();
      ocrTrainingJob.status = code === 0 ? "done" : "error";
      ocrTrainingJob.finished_at = new Date().toISOString();
      ocrTrainingJob.exit_code = code;
      ocrTrainingJob.message = code === 0
        ? "Training completado. Modelo en ./training_output"
        : `Training falló con código ${code}. Revisa el log.`;
      console.log(`Training ${code === 0 ? "completado" : "falló"} (código ${code}), log: ${logFile}`);
    });

    res.status(200).json({
      started: true,
      message: `Training iniciado con ${count} samples verificados`,
      verified_count: count,
      estimated_time: "10-30 minutos",
      status_url: "/api/ocr/training-status"
    });
  } catch (error: any) {
    console.error("Error en start-training:", error.message?.slice(0, 200));
    res.status(500).json({ error: error.message || "Error al iniciar training" });
  }
});

// POST /api/productos/:id/async-image - Asynchronous image processor
app.post("/api/productos/:id/async-image", upload.single('foto'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const productoId = parseInt(req.params.id);
    
    if (isNaN(productoId)) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: "No se recibió ninguna imagen" });
    }
    
    const taskId = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    
    // Save job state
    imageJobs.set(taskId, {
      taskId,
      productoId,
      progress: 0,
      status: 'pending'
    });
    
    // Trigger background process
    const fileBuffer = req.file.buffer;
    const processImageJob = async () => {
      try {
        const job = imageJobs.get(taskId);
        if (!job) return;
        
        job.status = 'processing';
        job.progress = 25;
        await new Promise(r => setTimeout(r, 400));
        
        job.progress = 50;
        await new Promise(r => setTimeout(r, 400));
        
        job.progress = 75;
        await new Promise(r => setTimeout(r, 400));
        
        const fotoHex = '\\x' + fileBuffer.toString('hex');
        
        const { error: updErr } = await supabase
          .from("productos")
          .update({ foto: fotoHex })
          .eq("id_producto", productoId);
          
        if (updErr) throw updErr;
        
        job.progress = 100;
        job.status = 'completed';
      } catch (err: any) {
        console.error("Async upload failed:", err);
        const job = imageJobs.get(taskId);
        if (job) {
          job.status = 'failed';
          job.error = err.message;
        }
      }
    };
    
    processImageJob();
    res.json({ success: true, taskId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/image-tasks/:taskId - Check background image task status
app.get("/api/image-tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const job = imageJobs.get(taskId);
  if (!job) {
    return res.status(404).json({ error: "Tarea no encontrada" });
  }
  res.json(job);
});

// GET /api/settings/image-sources - Retrieve custom image search sources
app.get("/api/settings/image-sources", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: settings, error } = await supabase
      .from("warehouse_settings")
      .select("valor")
      .eq("clave", "custom_image_sources")
      .single();
      
    if (error && error.code !== 'PGRST116') throw error;
    res.json(settings?.valor || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/image-sources - Save custom image search sources
app.post("/api/settings/image-sources", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { sources } = req.body;
    if (!Array.isArray(sources)) {
      return res.status(400).json({ error: "Las fuentes deben ser un array de URLs" });
    }
    
    const { error } = await supabase
      .from("warehouse_settings")
      .upsert({ clave: "custom_image_sources", valor: sources }, { onConflict: "clave" });
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/search-web-image - Search and assign product image from web in background
app.post("/api/productos/search-web-image", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { productoId, query } = req.body;
    
    const pId = parseInt(productoId);
    if (isNaN(pId)) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: "La consulta de búsqueda es obligatoria" });
    }
    
    const taskId = "websearch_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    
    imageJobs.set(taskId, {
      taskId,
      productoId: pId,
      progress: 0,
      status: 'pending'
    });
    
    const processWebSearch = async () => {
      try {
        const job = imageJobs.get(taskId);
        if (!job) return;
        
        job.status = 'processing';
        job.progress = 20;
        
        // Retrieve custom sources
        const { data: settings } = await supabase
          .from("warehouse_settings")
          .select("valor")
          .eq("clave", "custom_image_sources")
          .single();
          
        const customSources = settings?.valor || [];
        job.progress = 40;
        
        // Background search helper
          const searchProductImage = async (q: string, sources: string[]): Promise<Buffer | null> => {
            const logoKeywords = ["logo", "icon", "favicon", "banner", "avatar", "spacer", "pixel", "placeholder", "sprite"];
            const isLogoUrl = (url: string) => logoKeywords.some(k => url.toLowerCase().includes(k)) || url.endsWith(".gif") || url.endsWith(".svg");

            // Helper to extract product image from HTML — og:image is last resort (usually logo on search pages)
            const extractProductImage = (htmlContent: string): string | null => {
              // 1. Schema.org JSON-LD (structured data, most reliable)
              const ldJsonMatches = htmlContent.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
              if (ldJsonMatches) {
                for (const ldJsonMatch of ldJsonMatches) {
                  try {
                    const contentMatch = ldJsonMatch.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
                    if (contentMatch && contentMatch[1]) {
                      const json = JSON.parse(contentMatch[1]);
                      if (json.image) {
                        if (typeof json.image === 'string' && !isLogoUrl(json.image)) return json.image;
                        if (Array.isArray(json.image) && json.image.length > 0 && !isLogoUrl(json.image[0])) return json.image[0];
                        if (typeof json.image === 'object' && json.image.url && !isLogoUrl(json.image.url)) return json.image.url;
                      }
                    }
                  } catch (e) { /* ignore JSON parse errors */ }
                }
              }

              // 2. Image tags with specific product class/ID patterns
              const classMatch = htmlContent.match(/<img[^>]+(?:class|id)=["'][^"']*(?:product-gallery__media|product-image|main-image|primary-image|gallery|product__img|item-image|product-hero)[^"']*["'][^>]+src=["'](https?:\/\/[^"']+)["']/i) ||
                                htmlContent.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["'][^>]+(?:class|id)=["'][^"']*(?:product-gallery__media|product-image|main-image|primary-image|gallery|product__img|item-image|product-hero)[^"']*["']/i);
              if (classMatch && classMatch[1] && !isLogoUrl(classMatch[1])) return classMatch[1];

              // 3. Scan ALL img tags — pick the best (largest dimensions, filter out logos/icons)
              const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["'][^>]*/gi;
              let match;
              let bestImgUrl: string | null = null;
              let bestScore = 0;
              while ((match = imgRegex.exec(htmlContent)) !== null) {
                const imgUrl = match[1];
                const imgTag = match[0];
                if (isLogoUrl(imgUrl)) continue;

                let score = 1;
                const w = parseInt(imgTag.match(/width["']?\s*[:=]\s*["']?(\d+)/i)?.[1] || "0");
                const h = parseInt(imgTag.match(/height["']?\s*[:=]\s*["']?(\d+)/i)?.[1] || "0");
                if (w > 50 && h > 50) score = w * h;
                else if (!imgUrl.includes("thumb") && !imgUrl.includes("small")) score = 100;

                // Prefer images with "product" or "full" in path
                if (/product|full|large|zoom|hi[-_]?res|original/i.test(imgUrl)) score *= 2;

                if (score > bestScore) { bestScore = score; bestImgUrl = imgUrl; }
              }
              if (bestImgUrl) return bestImgUrl;

              // 4. og:image — last resort, usually the site logo on search/category pages
              const ogMatch = htmlContent.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                              htmlContent.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
              if (ogMatch && ogMatch[1] && !isLogoUrl(ogMatch[1])) return ogMatch[1];

              // 5. twitter:image — absolute last resort
              const twitterMatch = htmlContent.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
                                  htmlContent.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
              if (twitterMatch && twitterMatch[1] && !isLogoUrl(twitterMatch[1])) return twitterMatch[1];

              return null;
            };

            for (const source of sources) {
              try {
                const url = source.replace("{q}", encodeURIComponent(q));
                const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!resp.ok) continue;
                
                const contentType = resp.headers.get("content-type") || "";
                if (contentType.startsWith("image/")) {
                  return Buffer.from(await resp.arrayBuffer());
                }

                const html = await resp.text();

                // Extract best candidate image (img tags prioritized over og:image)
                const bestImgUrl = extractProductImage(html);
                if (bestImgUrl) {
                  const imgResp = await fetch(bestImgUrl);
                  if (imgResp.ok) {
                    return Buffer.from(await imgResp.arrayBuffer());
                  }
                }
              } catch (e) {
                console.error("Custom source failed:", e);
              }
            }
          // Fallback to DuckDuckGo image search API
          try {
            const searchUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(q + " clothing product")}&o=json`;
            const resp = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (resp.ok) {
              const data = await resp.json();
              const results: any[] = data.results || data.image || [];
              for (const item of results) {
                const imgUrl = item.image || item.thumbnail || item.url || "";
                if (!imgUrl || isLogoUrl(imgUrl)) continue;
                const finalUrl = imgUrl.startsWith("//") ? "https:" + imgUrl : imgUrl;
                const imgResp = await fetch(finalUrl);
                if (imgResp.ok) {
                  return Buffer.from(await imgResp.arrayBuffer());
                }
              }
            }
          } catch (e) {
            console.error("DuckDuckGo image API search failed:", e);
          }
          return null;
        };
        
        const imageBuffer = await searchProductImage(query, customSources);
        job.progress = 80;
        
        if (!imageBuffer) {
          throw new Error("No se encontró ninguna imagen de producto en la web");
        }
        
        const fotoHex = '\\x' + imageBuffer.toString('hex');
        const { error: updErr } = await supabase
          .from("productos")
          .update({ foto: fotoHex, has_foto: true })
          .eq("id_producto", pId);
          
        if (updErr) throw updErr;
        
        job.progress = 100;
        job.status = 'completed';
      } catch (err: any) {
        console.error("Web image search job failed:", err);
        const job = imageJobs.get(taskId);
        if (job) {
          job.status = 'failed';
          job.error = err.message;
        }
      }
    };
    
    processWebSearch();
    res.json({ success: true, taskId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/batch-register - Batch register products with metadata (without uploading files)
app.post("/api/productos/batch-register", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { products, id_caja, id_zona_nivel } = req.body;

    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "products debe ser un arreglo" });
    }

    const parsedProducts: any[] = [];
    const updatedProducts: any[] = [];

    for (const item of products) {
      try {
        let modelo = item.modelo_grupo || "";
        let colorCode = item.codigo_color || "";

        // Parse modelo y codigo_color si contiene un guion "-"
        if (modelo.includes("-")) {
          const parts = modelo.split("-");
          modelo = parts[0].trim();
          if (!colorCode) {
            colorCode = parts[1].trim();
          }
        }

        // Lógica inteligente de género
        let genero = "unisex";
        if (modelo.length > 0) {
          const firstChar = modelo.charAt(0).toUpperCase();
          const secondChar = modelo.length > 1 ? modelo.charAt(1).toUpperCase() : "";

          const isCalzado = item.tipo_producto?.toLowerCase().includes("calzado") ||
                            item.tipo_producto?.toLowerCase().includes("tenis") ||
                            item.tipo_producto?.toLowerCase().includes("zapato") ||
                            firstChar === "G";

          if (isCalzado && secondChar) {
            if (secondChar === "W") genero = "mujer";
            else if (secondChar === "M") genero = "hombre";
          } else {
            if (firstChar === "W") genero = "mujer";
            else if (firstChar === "M") genero = "hombre";
          }
        }

        // Registrar o actualizar producto
        const cleanSku = sanitizeIdentifier(item.sku || modelo, 100);
        if (cleanSku) {
          const fields = getProductFields();
          const { data: existing } = await supabase
            .from("productos")
            .select(fields)
            .eq("sku", cleanSku)
            .maybeSingle();

          let productRecord = existing;
          let wasUpdated = false;
          const changedFields: string[] = [];

          if (!productRecord) {
            // INSERT new product
            const insertData: any = {
              sku: cleanSku,
              ean_13: cleanSku,
              talla: sanitizeIdentifier(item.talla || "SinTalla", 50),
              temporada: "todouso",
              tipo: (sanitizeIdentifier(item.tipo_producto || "otro", 100) || "otro").toLowerCase(),
              marca_sub: sanitizeIdentifier(item.marca || "Guess", 100)
            };
            if (hasModeloGrupoColumn) {
              insertData.modelo_grupo = modelo || "sin modelo";
            }
            if (hasCodigoColorColumn && colorCode) {
              insertData.codigo_color = colorCode;
            }
            if (hasFechaTemporadaColumn && item.fecha_temporada) {
              insertData.fecha_temporada = sanitizeIdentifier(item.fecha_temporada, 50);
            }

            const { data: newProd, error: pErr } = await supabase
              .from("productos")
              .insert([insertData])
              .select(fields);

            if (pErr) throw pErr;
            if (newProd && newProd[0]) {
              productRecord = newProd[0];
            }
          } else {
            // UPDATE existing product if new data is more complete
            const updateData: any = {};
            const tallaVal = sanitizeIdentifier(item.talla || "", 50);
            if (tallaVal && tallaVal !== "SINTALLA" && (!productRecord.talla || productRecord.talla === "SinTalla")) {
              updateData.talla = tallaVal;
              changedFields.push("talla");
            }
            if (hasModeloGrupoColumn && modelo && modelo !== "sin modelo") {
              if (!productRecord.modelo_grupo || productRecord.modelo_grupo === "sin modelo") {
                updateData.modelo_grupo = modelo;
                changedFields.push("modelo_grupo");
              }
            }
            if (hasCodigoColorColumn && colorCode && !productRecord.codigo_color) {
              updateData.codigo_color = colorCode;
              changedFields.push("codigo_color");
            }
            if (hasFechaTemporadaColumn && item.fecha_temporada) {
              const tempVal = sanitizeIdentifier(item.fecha_temporada, 50);
              if (tempVal && !productRecord.fecha_temporada) {
                updateData.fecha_temporada = tempVal;
                changedFields.push("fecha_temporada");
              }
            }
            const marcaVal = sanitizeIdentifier(item.marca || "", 100);
            if (marcaVal && marcaVal !== "GUESS" && (!productRecord.marca_sub || productRecord.marca_sub === "Guess")) {
              updateData.marca_sub = marcaVal;
              changedFields.push("marca_sub");
            }

            if (Object.keys(updateData).length > 0) {
              const { data: updated } = await supabase
                .from("productos")
                .update(updateData)
                .eq("id_producto", productRecord.id_producto)
                .select(fields);
              if (updated && updated[0]) {
                productRecord = updated[0];
                wasUpdated = true;
              }
            }
          }

          if (productRecord) {
            const entry: any = {
              modelo_grupo: modelo,
              codigo_color: colorCode,
              sku: productRecord.sku,
              marca: productRecord.marca_sub,
              talla: productRecord.talla,
              tipo_producto: productRecord.tipo,
              genero,
              existeModelo: true,
              id_producto: productRecord.id_producto
            };
            parsedProducts.push(entry);
            if (wasUpdated && changedFields.length > 0) {
              updatedProducts.push({ ...entry, changed_fields: changedFields });
            }
          }
        }
      } catch (err: any) {
        console.error("Error al registrar producto en lote:", err);
      }
    }

    // Resolver asociación de contenedor
    let targetCajaId = id_caja ? parseInt(id_caja) : null;

    if (!targetCajaId && id_zona_nivel) {
      const lvlId = parseInt(id_zona_nivel);
      if (!isNaN(lvlId)) {
        const { data: lvlObj } = await supabase.from("zonas_nivel").select("nombre, id_zona_seccion").eq("id_zona_nivel", lvlId).maybeSingle();
        if (lvlObj) {
          const nameToMatch = `NIVEL: ${lvlObj.nombre.toUpperCase()}`;
          const { data: existingCaja } = await supabase
            .from("cajas")
            .select("id_caja")
            .eq("id_zona_nivel", lvlId)
            .eq("numero_caja", nameToMatch)
            .maybeSingle();

          if (existingCaja) {
            targetCajaId = existingCaja.id_caja;
          } else {
            const { data: newCaja } = await supabase
              .from("cajas")
              .insert([{
                numero_caja: nameToMatch,
                id_zona_nivel: lvlId,
                id_zona_seccion: lvlObj.id_zona_seccion,
                estado: 'vacia',
                tags: { tipo_producto: "ropa", genero: "todos", marca: "Guess" }
              }])
              .select();
            if (newCaja && newCaja[0]) {
              targetCajaId = newCaja[0].id_caja;
            }
          }
        }
      }
    }

    if (targetCajaId && parsedProducts.length > 0) {
      const { data: currentAssoc } = await supabase
        .from("caja_productos")
        .select("id_producto, cantidad")
        .eq("id_caja", targetCajaId);

      const assocMap = new Map<number, number>();
      if (currentAssoc) {
        currentAssoc.forEach((a: any) => assocMap.set(a.id_producto, a.cantidad));
      }

      // Verificar conflictos: productos que ya están en OTRO contenedor
      const productIds = parsedProducts.map(p => p.id_producto).filter(Boolean);
      const conflicts: any[] = [];

      if (productIds.length > 0) {
        const { data: existingInOther } = await supabase
          .from("caja_productos")
          .select("id_producto, id_caja, cantidad, cajas(numero_caja)")
          .in("id_producto", productIds)
          .neq("id_caja", targetCajaId);

        if (existingInOther && existingInOther.length > 0) {
          for (const assoc of existingInOther) {
            const prod = parsedProducts.find(p => p.id_producto === assoc.id_producto);
            if (prod) {
              conflicts.push({
                id_producto: assoc.id_producto,
                modelo_grupo: prod.modelo_grupo,
                sku: prod.sku,
                existing_caja: assoc.cajas?.numero_caja || `Caja ${assoc.id_caja}`,
                existing_caja_id: assoc.id_caja,
                existing_cantidad: assoc.cantidad
              });
            }
          }
        }
      }

      const scanCounts = new Map<number, number>();
      parsedProducts.forEach(p => {
        if (p.id_producto) {
          scanCounts.set(p.id_producto, (scanCounts.get(p.id_producto) || 0) + 1);
        }
      });

      const associations = Array.from(scanCounts.entries()).map(([prodId, count]) => {
        const currentQty = assocMap.get(prodId) || 0;
        return {
          id_caja: targetCajaId,
          id_producto: prodId,
          cantidad: currentQty + count
        };
      });

      if (associations.length > 0) {
        const { error: assocErr } = await supabase
          .from("caja_productos")
          .upsert(associations, { onConflict: "id_caja,id_producto" });

        if (assocErr) throw assocErr;
        await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", targetCajaId).eq("estado", "vacia");
      }

      // Emit domain event for real-time sync
      emitDomainEvent("producto:batch-registered", {
        id_caja: targetCajaId,
        count: parsedProducts.length,
        updated: updatedProducts.length
      });

      res.json({ parsedProducts, conflicts, updated: updatedProducts });
    } else {
      res.json({ parsedProducts, conflicts: [], updated: updatedProducts });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/move-container - Mover producto de un contenedor a otro
app.post("/api/productos/move-container", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id_producto, from_caja_id, to_caja_id, cantidad } = req.body;

    if (!id_producto || !to_caja_id) {
      return res.status(400).json({ error: "id_producto y to_caja_id requeridos" });
    }

    // Quitar del contenedor origen
    if (from_caja_id) {
      const { data: current } = await supabase
        .from("caja_productos")
        .select("cantidad")
        .eq("id_caja", from_caja_id)
        .eq("id_producto", id_producto)
        .maybeSingle();

      if (current) {
        const newQty = (current.cantidad || 0) - (cantidad || 1);
        if (newQty <= 0) {
          await supabase.from("caja_productos")
            .delete()
            .eq("id_caja", from_caja_id)
            .eq("id_producto", id_producto);
        } else {
          await supabase.from("caja_productos")
            .update({ cantidad: newQty })
            .eq("id_caja", from_caja_id)
            .eq("id_producto", id_producto);
        }
      }
    }

    // Agregar al contenedor destino
    const { data: existingDest } = await supabase
      .from("caja_productos")
      .select("cantidad")
      .eq("id_caja", to_caja_id)
      .eq("id_producto", id_producto)
      .maybeSingle();

    if (existingDest) {
      await supabase.from("caja_productos")
        .update({ cantidad: (existingDest.cantidad || 0) + (cantidad || 1) })
        .eq("id_caja", to_caja_id)
        .eq("id_producto", id_producto);
    } else {
      await supabase.from("caja_productos")
        .insert([{ id_caja: to_caja_id, id_producto, cantidad: cantidad || 1 }]);
    }

    await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", to_caja_id).eq("estado", "vacia");

    emitDomainEvent("caja:updated", { id_caja: from_caja_id, id_caja_destino: to_caja_id, id_producto, cantidad: cantidad || 1 });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- WAREHOUSE LOCATIONS ENDPOINTS ---

// GET /api/almacen/zonas - List all warehouse zones
app.get("/api/almacen/zonas", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: zones, error: zErr } = await supabase
      .from("zonas_almacen")
      .select("*")
      .order("nombre", { ascending: true });
      
    if (zErr) throw zErr;
    res.json(zones);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/zonas - Create a warehouse zone
app.post("/api/almacen/zonas", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre de zona es requerido y debe ser válido" });
    }
    
    const cleanNombre = nombre.toLowerCase();
    const { data, error } = await supabase
      .from("zonas_almacen")
      .insert([{ nombre: cleanNombre }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/almacen/zonas/:id - Update warehouse zone name
app.put("/api/almacen/zonas/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de zona inválido" });
    }
    let { nombre } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre es requerido y debe ser válido" });
    }
    
    const cleanNombre = nombre.toLowerCase();
    const { data, error } = await supabase
      .from("zonas_almacen")
      .update({ nombre: cleanNombre })
      .eq("id_zona_almacen", id)
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/almacen/zonas/:id - Delete warehouse zone
app.delete("/api/almacen/zonas/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de zona inválido" });
    }
    
    const { error } = await supabase
      .from("zonas_almacen")
      .delete()
      .eq("id_zona_almacen", id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- ZONAS PASILLOS ENDPOINTS (Nivel 2) ---

// GET /api/almacen/pasillos - List all pasillos
app.get("/api/almacen/pasillos", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: pasillos, error: pErr } = await supabase
      .from("zonas_pasillo")
      .select(`
        id_zona_pasillo,
        nombre,
        id_zona_almacen,
        zonas_almacen (nombre)
      `)
      .order("nombre", { ascending: true });
      
    if (pErr) throw pErr;
    
    const result = (pasillos || []).map((p: any) => ({
      id_zona_pasillo: p.id_zona_pasillo,
      nombre: p.nombre,
      id_zona_almacen: p.id_zona_almacen,
      almacen_nombre: p.zonas_almacen ? p.zonas_almacen.nombre : "Sin almacén"
    }));
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/pasillos - Create pasillo
app.post("/api/almacen/pasillos", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre, id_zona_almacen } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre de pasillo es requerido y debe ser válido" });
    }
    const parsedAlm = parseInt(id_zona_almacen);
    if (isNaN(parsedAlm) || parsedAlm <= 0) {
      return res.status(400).json({ error: "La zona de almacén es requerida e inválida" });
    }
    
    const cleanNombre = nombre.toLowerCase();
    const { data, error } = await supabase
      .from("zonas_pasillo")
      .insert([{
        nombre: cleanNombre,
        id_zona_almacen: parsedAlm
      }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/almacen/pasillos/:id - Update pasillo
app.put("/api/almacen/pasillos/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de pasillo inválido" });
    }
    let { nombre, id_zona_almacen } = req.body;
    
    const updateData: any = {};
    if (nombre !== undefined) {
      nombre = sanitizeIdentifier(nombre, 50);
      if (!nombre) return res.status(400).json({ error: "El nombre debe ser válido" });
      updateData.nombre = nombre.toLowerCase();
    }
    if (id_zona_almacen !== undefined) {
      const parsedAlm = parseInt(id_zona_almacen);
      if (isNaN(parsedAlm) || parsedAlm <= 0) {
        return res.status(400).json({ error: "La zona de almacén debe ser válida" });
      }
      updateData.id_zona_almacen = parsedAlm;
    }
    
    const { data, error } = await supabase
      .from("zonas_pasillo")
      .update(updateData)
      .eq("id_zona_pasillo", id)
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/almacen/pasillos/:id - Delete pasillo
app.delete("/api/almacen/pasillos/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de pasillo inválido" });
    }
    
    const { error } = await supabase
      .from("zonas_pasillo")
      .delete()
      .eq("id_zona_pasillo", id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/almacen/secciones - List all section zones
app.get("/api/almacen/secciones", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { data: sections, error: sErr } = await supabase
      .from("zonas_seccion")
      .select(`
        id_zona_seccion,
        nombre,
        id_zona_almacen,
        id_zona_pasillo,
        tags,
        zonas_almacen (nombre),
        zonas_pasillo (
          nombre,
          id_zona_almacen,
          zonas_almacen (nombre)
        )
      `)
      .order("nombre", { ascending: true });
      
    if (sErr) throw sErr;
    
    const result = (sections || []).map((s: any) => {
      const pasilloNombre = s.zonas_pasillo ? s.zonas_pasillo.nombre : "Sin pasillo";
      const almacenNombre = s.zonas_pasillo && s.zonas_pasillo.zonas_almacen 
        ? s.zonas_pasillo.zonas_almacen.nombre 
        : (s.zonas_almacen ? s.zonas_almacen.nombre : "Sin almacén");

      return {
        id_zona_seccion: s.id_zona_seccion,
        nombre: s.nombre,
        id_zona_almacen: s.id_zona_almacen || (s.zonas_pasillo ? s.zonas_pasillo.id_zona_almacen : null),
        id_zona_pasillo: s.id_zona_pasillo,
        tags: s.tags || { tipo_producto: "todos", genero: "todos", marca: "todos" },
        pasillo_nombre: pasilloNombre,
        almacen_nombre: almacenNombre
      };
    });
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/secciones - Create section zone
app.post("/api/almacen/secciones", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre, id_zona_almacen, id_zona_pasillo, tags } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre de sección es requerido y debe ser válido" });
    }
    
    const insertData: any = {
      nombre: nombre.toLowerCase(),
      tags: tags || { tipo_producto: "todos", genero: "todos", marca: "todos" }
    };
    
    if (id_zona_almacen) {
      insertData.id_zona_almacen = parseInt(id_zona_almacen);
    }
    if (id_zona_pasillo) {
      insertData.id_zona_pasillo = parseInt(id_zona_pasillo);
    }
    
    const { data, error } = await supabase
      .from("zonas_seccion")
      .insert([insertData])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/almacen/secciones/:id - Update section zone
app.put("/api/almacen/secciones/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de sección inválido" });
    }
    let { nombre, id_zona_almacen, id_zona_pasillo, tags } = req.body;
    
    const updateData: any = {};
    if (nombre !== undefined) {
      nombre = sanitizeIdentifier(nombre, 50);
      if (!nombre) return res.status(400).json({ error: "El nombre debe ser válido" });
      updateData.nombre = nombre.toLowerCase();
    }
    if (id_zona_almacen !== undefined) {
      updateData.id_zona_almacen = id_zona_almacen ? parseInt(id_zona_almacen) : null;
    }
    if (id_zona_pasillo !== undefined) {
      updateData.id_zona_pasillo = id_zona_pasillo ? parseInt(id_zona_pasillo) : null;
    }
    if (tags !== undefined) {
      updateData.tags = tags;
    }
    
    const { data, error } = await supabase
      .from("zonas_seccion")
      .update(updateData)
      .eq("id_zona_seccion", id)
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- NIVELES (NIVEL 4) ENDPOINTS ---

// GET /api/almacen/niveles - List all levels
app.get("/api/almacen/niveles", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: niveles, error: nErr } = await supabase
      .from("zonas_nivel")
      .select(`
        id_zona_nivel,
        nombre,
        id_zona_seccion,
        tags,
        created_at,
        zonas_seccion (
          nombre,
          id_zona_almacen,
          id_zona_pasillo,
          zonas_almacen (nombre),
          zonas_pasillo (nombre)
        )
      `)
      .order("nombre", { ascending: true });
      
    if (nErr) throw nErr;
    
    const result = (niveles || []).map((n: any) => {
      const secNombre = n.zonas_seccion ? n.zonas_seccion.nombre : "Sin sección";
      const pasNombre = n.zonas_seccion && n.zonas_seccion.zonas_pasillo 
        ? n.zonas_seccion.zonas_pasillo.nombre 
        : "Sin pasillo";
      const almNombre = n.zonas_seccion && n.zonas_seccion.zonas_almacen 
        ? n.zonas_seccion.zonas_almacen.nombre 
        : "Sin almacén";
        
      return {
        id_zona_nivel: n.id_zona_nivel,
        nombre: n.nombre,
        id_zona_seccion: n.id_zona_seccion,
        tags: n.tags || { tipo_producto: "todos", genero: "todos", marca: "todos" },
        seccion_nombre: secNombre,
        pasillo_nombre: pasNombre,
        almacen_nombre: almNombre,
        id_zona_pasillo: n.zonas_seccion ? n.zonas_seccion.id_zona_pasillo : null,
        id_zona_almacen: n.zonas_seccion ? n.zonas_seccion.id_zona_almacen : null,
        created_at: n.created_at
      };
    });
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/niveles - Create level
app.post("/api/almacen/niveles", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre, id_zona_seccion, tags } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre de nivel es requerido" });
    }
    const parsedSec = parseInt(id_zona_seccion);
    if (isNaN(parsedSec) || parsedSec <= 0) {
      return res.status(400).json({ error: "ID de sección inválido" });
    }
    
    const { data, error } = await supabase
      .from("zonas_nivel")
      .insert([{
        nombre: nombre.toLowerCase(),
        id_zona_seccion: parsedSec,
        tags: tags || { tipo_producto: "todos", genero: "todos", marca: "todos" }
      }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/niveles/bulk - Bulk create levels
app.post("/api/almacen/niveles/bulk", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { id_zona_seccion, prefijo, inicio, fin, tags } = req.body;
    
    const parsedSec = parseInt(id_zona_seccion);
    if (isNaN(parsedSec) || parsedSec <= 0) {
      return res.status(400).json({ error: "ID de sección inválido" });
    }
    
    const startIdx = parseInt(inicio);
    const endIdx = parseInt(fin);
    if (isNaN(startIdx) || isNaN(endIdx) || startIdx > endIdx) {
      return res.status(400).json({ error: "Rango de numeración inválido" });
    }
    
    const cleanPrefijo = sanitizeIdentifier(prefijo || "NIV-", 50);
    const cleanTags = tags || { tipo_producto: "todos", genero: "todos", marca: "todos" };
    
    const inserts = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const levelName = `${cleanPrefijo}${i}`.toLowerCase();
      inserts.push({
        nombre: levelName,
        id_zona_seccion: parsedSec,
        tags: cleanTags
      });
    }
    
    const { data, error } = await supabase
      .from("zonas_nivel")
      .insert(inserts)
      .select();
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/almacen/niveles/:id - Update level
app.put("/api/almacen/niveles/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de nivel inválido" });
    }
    let { nombre, id_zona_seccion, tags } = req.body;
    
    const updateData: any = {};
    if (nombre !== undefined) {
      nombre = sanitizeIdentifier(nombre, 50);
      if (!nombre) return res.status(400).json({ error: "El nombre debe ser válido" });
      updateData.nombre = nombre.toLowerCase();
    }
    if (id_zona_seccion !== undefined) {
      const parsedSec = parseInt(id_zona_seccion);
      if (isNaN(parsedSec) || parsedSec <= 0) {
        return res.status(400).json({ error: "ID de sección inválido" });
      }
      updateData.id_zona_seccion = parsedSec;
    }
    if (tags !== undefined) {
      updateData.tags = tags;
    }
    
    const { data, error } = await supabase
      .from("zonas_nivel")
      .update(updateData)
      .eq("id_zona_nivel", id)
      .select();
      
    if (error) throw error;
    res.json(data[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/almacen/niveles/:id - Delete level
app.delete("/api/almacen/niveles/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de nivel inválido" });
    }
    
    const { error } = await supabase
      .from("zonas_nivel")
      .delete()
      .eq("id_zona_nivel", id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/secciones/bulk - Bulk create sections
app.post("/api/almacen/secciones/bulk", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { id_zona_almacen, id_zona_pasillo, prefijo, inicio, fin, tags } = req.body;
    
    const startIdx = parseInt(inicio);
    const endIdx = parseInt(fin);
    if (isNaN(startIdx) || isNaN(endIdx) || startIdx > endIdx) {
      return res.status(400).json({ error: "Rango de numeración inválido" });
    }
    
    const cleanPrefijo = sanitizeIdentifier(prefijo || "SEC-", 50);
    const cleanTags = tags || { tipo_producto: "todos", genero: "todos", marca: "todos" };
    
    const inserts = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const secName = `${cleanPrefijo}${i}`.toLowerCase();
      inserts.push({
        nombre: secName,
        id_zona_almacen: id_zona_almacen ? parseInt(id_zona_almacen) : null,
        id_zona_pasillo: id_zona_pasillo ? parseInt(id_zona_pasillo) : null,
        tags: cleanTags
      });
    }
    
    const { data, error } = await supabase
      .from("zonas_seccion")
      .insert(inserts)
      .select();
      
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos/grupo - Register group of products with a single photo
app.post("/api/productos/grupo", upload.single('foto'), async (req, res) => {
  try {
    await detectSchema();
    const supabase = getSupabase();
    let { modelo_grupo, temporada, tipo, marca_sub, variaciones, id_caja, id_zona_nivel, id_zona_seccion, id_zona_almacen } = req.body;
    
    modelo_grupo = sanitizeIdentifier(modelo_grupo, 100);
    if (!modelo_grupo || modelo_grupo === "sin modelo") {
      return res.status(400).json({ error: "El Modelo de Grupo es obligatorio para registro grupal" });
    }
    
    let parsedVariaciones = [];
    try {
      parsedVariaciones = typeof variaciones === 'string' ? JSON.parse(variaciones) : (Array.isArray(variaciones) ? variaciones : []);
    } catch (e) {
      return res.status(400).json({ error: "El formato de variaciones es inválido" });
    }
    
    if (parsedVariaciones.length === 0) {
      return res.status(400).json({ error: "Debes agregar al menos una variación de producto" });
    }
    
    temporada = (sanitizeIdentifier(temporada, 100) || "todouso").toLowerCase();
    tipo = (sanitizeIdentifier(tipo, 100) || "otro").toLowerCase();
    marca_sub = sanitizeIdentifier(marca_sub, 100) || "Guess";
    
    // Fetch all existing products that match any of the input SKUs to separate inserts from existing ones
    const skusToCheck = parsedVariaciones.map((v: any) => sanitizeIdentifier(v.sku, 100)).filter(Boolean);
    const fields = getProductFields();
    const { data: existingProds, error: fetchErr } = await supabase
      .from("productos")
      .select(fields)
      .in("sku", skusToCheck);
    
    if (fetchErr) throw fetchErr;

    const existingSkuMap = new Map<string, any>();
    if (existingProds) {
      existingProds.forEach((p: any) => {
        existingSkuMap.set(p.sku.toLowerCase(), p);
      });
    }

    const newProductInserts: any[] = [];
    const alreadyExistingProds: any[] = [];

    parsedVariaciones.forEach((v: any) => {
      const cleanSku = sanitizeIdentifier(v.sku, 100);
      const cleanTalla = sanitizeIdentifier(v.talla, 50) || "SinTalla";
      let baseModel = modelo_grupo;
      let color = sanitizeIdentifier(v.codigo_color || v.color || "", 50);
      
      if (baseModel.includes("-") && !color) {
        const parts = baseModel.split("-");
        baseModel = parts[0];
        color = parts[parts.length - 1];
      }
      
      const fecha_temporada = sanitizeIdentifier(v.fecha_temporada || v.season_date || "", 50);
      const existing = existingSkuMap.get(cleanSku.toLowerCase());

      if (existing) {
        alreadyExistingProds.push(existing);
      } else {
        const insertData: any = {
          sku: cleanSku,
          ean_13: cleanSku,
          talla: cleanTalla,
          temporada,
          tipo,
          marca_sub
        };
        if (req.file) {
          insertData.foto = '\\x' + req.file.buffer.toString('hex');
        }
        if (hasModeloGrupoColumn) {
          insertData.modelo_grupo = baseModel;
        }
        if (hasFechaTemporadaColumn && fecha_temporada) {
          insertData.fecha_temporada = fecha_temporada;
        }
        if (hasCodigoColorColumn && color) {
          insertData.codigo_color = color;
        }
        newProductInserts.push(insertData);
      }
    });

    let createdProducts: any[] = [];

    if (newProductInserts.length > 0) {
      const { data, error: pErr } = await supabase
        .from("productos")
        .insert(newProductInserts)
        .select(fields);
        
      if (pErr) throw pErr;
      if (data) createdProducts = data;
    }

    // Combine all products (created + existing)
    const allProducts = [...createdProducts, ...alreadyExistingProds];
    
    // Check if we need to associate them with a container
    let targetCajaId = id_caja ? parseInt(id_caja) : null;
    
    if (!targetCajaId) {
      if (id_zona_nivel) {
        const lvlId = parseInt(id_zona_nivel);
        if (!isNaN(lvlId)) {
          // Look for existing virtual caja for this level
          const { data: lvlObj } = await supabase.from("zonas_nivel").select("nombre, id_zona_seccion").eq("id_zona_nivel", lvlId).maybeSingle();
          if (lvlObj) {
            const nameToMatch = `NIVEL: ${lvlObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_nivel", lvlId)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_nivel: lvlId,
                  id_zona_seccion: lvlObj.id_zona_seccion,
                  estado: 'vacia',
                  tags: { tipo_producto: tipo, genero: "todos", marca: marca_sub }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      } else if (id_zona_seccion) {
        const secId = parseInt(id_zona_seccion);
        if (!isNaN(secId)) {
          const { data: secObj } = await supabase.from("zonas_seccion").select("nombre").eq("id_zona_seccion", secId).maybeSingle();
          if (secObj) {
            const nameToMatch = `SECCIÓN: ${secObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_seccion", secId)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_seccion: secId,
                  estado: 'vacia',
                  tags: { tipo_producto: tipo, genero: "todos", marca: marca_sub }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      } else if (id_zona_almacen) {
        const almId = parseInt(id_zona_almacen);
        if (!isNaN(almId)) {
          const { data: almObj } = await supabase.from("zonas_almacen").select("nombre").eq("id_zona_almacen", almId).maybeSingle();
          if (almObj) {
            const nameToMatch = `ALMACÉN: ${almObj.nombre.toUpperCase()}`;
            const { data: existingCaja } = await supabase
              .from("cajas")
              .select("id_caja")
              .eq("id_zona_almacen", almId)
              .is("id_zona_seccion", null)
              .eq("numero_caja", nameToMatch)
              .maybeSingle();
              
            if (existingCaja) {
              targetCajaId = existingCaja.id_caja;
            } else {
              const { data: newCaja } = await supabase
                .from("cajas")
                .insert([{
                  numero_caja: nameToMatch,
                  id_zona_almacen: almId,
                  estado: 'vacia',
                  tags: { tipo_producto: tipo, genero: "todos", marca: marca_sub }
                }])
                .select();
              if (newCaja && newCaja[0]) {
                targetCajaId = newCaja[0].id_caja;
              }
            }
          }
        }
      }
    }
    
    // Associate products to target caja if resolved
    if (targetCajaId) {
      const associations = allProducts.map((prod: any) => {
        const matchingVar = parsedVariaciones.find((v: any) => sanitizeIdentifier(v.sku, 100).toLowerCase() === prod.sku.toLowerCase());
        const qty = matchingVar ? parseInt(matchingVar.cantidad) || 1 : 1;
        return {
          id_caja: targetCajaId,
          id_producto: prod.id_producto,
          cantidad: qty
        };
      });
      
      const { error: assocErr } = await supabase
        .from("caja_productos")
        .upsert(associations, { onConflict: "id_caja,id_producto" });
        
      if (assocErr) throw assocErr;
      
      // Update box state to 'activa' if it was vacant
      await supabase.from("cajas").update({ estado: 'activa' }).eq("id_caja", targetCajaId).eq("estado", "vacia");
    }
    
    res.json({
      success: true,
      products: allProducts
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/almacen/product-counts - Get total associated products for each warehouse level (1-4)
app.get("/api/almacen/product-counts", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    // 1. Fetch boxes with their products
    const { data: boxesData, error: bErr } = await supabase
      .from("cajas")
      .select(`
        id_caja,
        id_zona_almacen,
        id_zona_seccion,
        id_zona_nivel,
        caja_productos (cantidad)
      `);
      
    if (bErr) throw bErr;
    
    // 2. Fetch warehouse layout
    const { data: nivelesData, error: nErr } = await supabase
      .from("zonas_nivel")
      .select("id_zona_nivel, id_zona_seccion");
    if (nErr) throw nErr;
    
    const { data: seccionesData, error: sErr } = await supabase
      .from("zonas_seccion")
      .select("id_zona_seccion, id_zona_pasillo, id_zona_almacen");
    if (sErr) throw sErr;
    
    const { data: pasillosData, error: pErr } = await supabase
      .from("zonas_pasillo")
      .select("id_zona_pasillo, id_zona_almacen");
    if (pErr) throw pErr;
    
    // Process mappings
    const boxQtyMap = new Map<number, number>();
    const boxLocations = new Map<number, { id_zona_almacen: number|null, id_zona_seccion: number|null, id_zona_nivel: number|null }>();
    
    (boxesData || []).forEach((box: any) => {
      const qty = (box.caja_productos || []).reduce((sum: number, cp: any) => sum + (cp.cantidad || 0), 0);
      boxQtyMap.set(box.id_caja, qty);
      boxLocations.set(box.id_caja, {
        id_zona_almacen: box.id_zona_almacen,
        id_zona_seccion: box.id_zona_seccion,
        id_zona_nivel: box.id_zona_nivel
      });
    });
    
    const nivelToSeccion = new Map<number, number>();
    (nivelesData || []).forEach((n: any) => {
      nivelToSeccion.set(n.id_zona_nivel, n.id_zona_seccion);
    });
    
    const seccionToPasilloAndZone = new Map<number, { id_zona_pasillo: number|null, id_zona_almacen: number|null }>();
    (seccionesData || []).forEach((s: any) => {
      seccionToPasilloAndZone.set(s.id_zona_seccion, {
        id_zona_pasillo: s.id_zona_pasillo,
        id_zona_almacen: s.id_zona_almacen
      });
    });
    
    const pasilloToZone = new Map<number, number>();
    (pasillosData || []).forEach((p: any) => {
      pasilloToZone.set(p.id_zona_pasillo, p.id_zona_almacen);
    });
    
    // Accumulators
    const zoneCounts: Record<number, number> = {};
    const pasilloCounts: Record<number, number> = {};
    const seccionCounts: Record<number, number> = {};
    const nivelCounts: Record<number, number> = {};
    
    boxLocations.forEach((loc, id_caja) => {
      const qty = boxQtyMap.get(id_caja) || 0;
      if (qty === 0) return;
      
      let resolvedZoneId: number | null = loc.id_zona_almacen;
      let resolvedPasilloId: number | null = null;
      let resolvedSeccionId: number | null = loc.id_zona_seccion;
      let resolvedNivelId: number | null = loc.id_zona_nivel;
      
      if (resolvedNivelId) {
        const secId = nivelToSeccion.get(resolvedNivelId);
        if (secId) {
          resolvedSeccionId = secId;
        }
      }
      
      if (resolvedSeccionId) {
        const secInfo = seccionToPasilloAndZone.get(resolvedSeccionId);
        if (secInfo) {
          resolvedPasilloId = secInfo.id_zona_pasillo;
          if (secInfo.id_zona_almacen) {
            resolvedZoneId = secInfo.id_zona_almacen;
          }
        }
      }
      
      if (resolvedPasilloId && !resolvedZoneId) {
        const zoneId = pasilloToZone.get(resolvedPasilloId);
        if (zoneId) {
          resolvedZoneId = zoneId;
        }
      }
      
      // Accumulate counts
      if (resolvedZoneId) {
        zoneCounts[resolvedZoneId] = (zoneCounts[resolvedZoneId] || 0) + qty;
      }
      if (resolvedPasilloId) {
        pasilloCounts[resolvedPasilloId] = (pasilloCounts[resolvedPasilloId] || 0) + qty;
      }
      if (resolvedSeccionId) {
        seccionCounts[resolvedSeccionId] = (seccionCounts[resolvedSeccionId] || 0) + qty;
      }
      if (resolvedNivelId) {
        nivelCounts[resolvedNivelId] = (nivelCounts[resolvedNivelId] || 0) + qty;
      }
    });
    
    res.json({
      zonas: zoneCounts,
      pasillos: pasilloCounts,
      secciones: seccionCounts,
      niveles: nivelCounts
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- VITE MIDDLEWARE ---

async function startServer() {
  // Normalizar marcas en la base de datos de manera asíncrona al iniciar
  try {
    const supabase = getSupabase();
    supabase.from("productos").update({ marca_sub: "Guess" }).eq("marca_sub", "Gues").then(({ error }) => {
      if (error) console.error("Error al normalizar Gues a Guess:", error.message);
    });
    supabase.from("productos").update({ marca_sub: "GuessEco" }).eq("marca_sub", "Guess-eco").then(({ error }) => {
      if (error) console.error("Error al normalizar Guess-eco a GuessEco:", error.message);
    });
    supabase.from("productos").update({ marca_sub: "GuessEco" }).eq("marca_sub", "guesseco").then(({ error }) => {
      if (error) console.error("Error al normalizar guesseco a GuessEco:", error.message);
    });
  } catch (err: any) {
    console.error("Error al iniciar normalización de marcas:", err.message);
  }

  // ============================================================
  // FIELCLUB LOYALTY — Clientes, Wallet, POS Venta Simulado
  // ============================================================

  function generateLoyaltyRef(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let r = 'FIEL-';
    for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return r;
  }

  // Normaliza valores fiscales: null/undefined/""/"NULL" → null (sin datos válidos)
  function cleanFiscalValue(v: any): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === "" || s.toUpperCase() === "NULL") return null;
    return s;
  }

  // POST /api/loyalty/clientes — Registro con email + contraseña (nombre opcional)
  app.post("/api/loyalty/clientes", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { nombre, correo, telefono, cumple, password } = req.body;
      if (!correo || !correo.trim()) return res.status(400).json({ error: "correo requerido" });
      if (password && password.length < 6) return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
      const correoLower = correo.trim().toLowerCase();

      const { data: existente } = await supabase.from("loyalty_clientes").select("id, password_hash").eq("correo", correoLower).maybeSingle();
      if (existente) {
        // Si la cuenta existe pero no tiene contraseña (creada por ref), se vincula la nueva
        if (password && !existente.password_hash) {
          const hash = await bcrypt.hash(password, 10);
          const { data: vinculado, error: vinErr } = await supabase.from("loyalty_clientes")
            .update({ password_hash: hash, updated_at: new Date().toISOString() })
            .eq("id", existente.id).select().single();
          if (vinErr) throw vinErr;
          if (vinculado && "password_hash" in vinculado) delete vinculado.password_hash;
          return res.status(200).json(vinculado);
        }
        return res.status(409).json({ error: "Ya existe una cuenta con ese correo" });
      }

      const refCode = generateLoyaltyRef();
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const nombreFinal = (nombre || correoLower.split("@")[0] || "Socio AURA").trim();
      const { data, error } = await supabase.from("loyalty_clientes").insert([{
        ref: refCode,
        nombre: nombreFinal,
        correo: correoLower,
        telefono,
        cumple,
        saldo_monedero: 0,
        password_hash: passwordHash
      }]).select().single();
      if (error) throw error;
      if (data && "password_hash" in data) delete data.password_hash;
      await supabase.from("loyalty_cupones").insert([{ cliente_id: data.id, codigo: `BIENVENIDA-${refCode}`, descripcion: "$200 en tu primera compra", tipo: "fijo", valor: 200, generado_por: "bienvenida", expira: new Date(Date.now() + 90*86400000).toISOString().split('T')[0] }]);
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/login — Login con email + contraseña
  app.post("/api/loyalty/login", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { correo, password } = req.body;
      if (!correo || !password) return res.status(400).json({ error: "correo y contraseña requeridos" });
      const { data: cli } = await supabase.from("loyalty_clientes").select("*").eq("correo", correo.trim().toLowerCase()).maybeSingle();
      if (!cli) return res.status(404).json({ error: "No existe una cuenta con ese correo" });
      if (!cli.password_hash) return res.status(400).json({ error: "Esta cuenta se creó por ref y no tiene contraseña. Usa tu ref o crea una cuenta nueva." });
      const ok = await bcrypt.compare(password, cli.password_hash);
      if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });
      if (cli && "password_hash" in cli) delete cli.password_hash;
      res.json(cli);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref
  app.get("/api/loyalty/cliente/:ref", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.from("loyalty_clientes").select("*").eq("ref", req.params.ref).single();
      if (error) return res.status(404).json({ error: "Cliente no encontrado" });
      if (data && "password_hash" in data) delete data.password_hash;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/loyalty/cliente/:ref
  app.put("/api/loyalty/cliente/:ref", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { nombre, correo, telefono, cumple, rfc, razon_social, uso_cfdi, direccion_fiscal, codigo_postal, correo_facturacion } = req.body;
      const updates: any = { nombre, correo, telefono, cumple, updated_at: new Date().toISOString() };
      // Campos fiscales (solo si vienen definidos)
      if (rfc !== undefined) updates.rfc = rfc;
      if (razon_social !== undefined) updates.razon_social = razon_social;
      if (uso_cfdi !== undefined) updates.uso_cfdi = uso_cfdi;
      if (direccion_fiscal !== undefined) updates.direccion_fiscal = direccion_fiscal;
      if (codigo_postal !== undefined) updates.codigo_postal = codigo_postal;
      if (correo_facturacion !== undefined) updates.correo_facturacion = correo_facturacion;
      const { data, error } = await supabase.from("loyalty_clientes").update(updates).eq("ref", req.params.ref).select().single();
      if (error) throw error;
      if (data && "password_hash" in data) delete data.password_hash;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref/tarjetas
  app.get("/api/loyalty/cliente/:ref/tarjetas", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data } = await supabase.from("loyalty_tarjetas").select("*").eq("cliente_id", cli.id);
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/cliente/:ref/tarjetas
  app.post("/api/loyalty/cliente/:ref/tarjetas", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { alias, ultimos_digitos, tipo, banco } = req.body;
      const { data } = await supabase.from("loyalty_tarjetas").insert([{ cliente_id: cli.id, alias, ultimos_digitos: String(ultimos_digitos || "").replace(/[^0-9]/g, "").slice(-4), tipo: tipo||"debito", banco }]).select().single();
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/loyalty/cliente/:ref/tarjetas/:id — Editar tarjeta
  app.put("/api/loyalty/cliente/:ref/tarjetas/:id", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { alias, ultimos_digitos, tipo, banco } = req.body;
      const updates: any = {};
      if (alias !== undefined) updates.alias = alias;
      if (ultimos_digitos !== undefined) updates.ultimos_digitos = String(ultimos_digitos).replace(/[^0-9]/g, "").slice(-4);
      if (tipo !== undefined) updates.tipo = tipo;
      if (banco !== undefined) updates.banco = banco;
      const { data, error } = await supabase.from("loyalty_tarjetas").update(updates).eq("id", req.params.id).eq("cliente_id", cli.id).select().single();
      if (error || !data) return res.status(404).json({ error: "Tarjeta no encontrada" });
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/loyalty/cliente/:ref/tarjetas/:id — Eliminar tarjeta
  app.delete("/api/loyalty/cliente/:ref/tarjetas/:id", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { error } = await supabase.from("loyalty_tarjetas").delete().eq("id", req.params.id).eq("cliente_id", cli.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref/cupones
  app.get("/api/loyalty/cliente/:ref/cupones", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data } = await supabase.from("loyalty_cupones").select("*").eq("cliente_id", cli.id).eq("usado", false);
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/cliente/:ref/cupones/generar
  app.post("/api/loyalty/cliente/:ref/cupones/generar", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("*").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const cupones = [{ tipo: "porcentaje", valor: 15, desc: "15% OFF" },{ tipo: "fijo", valor: 150, desc: "$150 OFF" },{ tipo: "envio_gratis", valor: 0, desc: "Envío gratis" }];
      const c = cupones[Math.floor(Math.random()*cupones.length)];
      const codigo = `CUPON-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const { data } = await supabase.from("loyalty_cupones").insert([{ cliente_id: cli.id, codigo, descripcion: c.desc, tipo: c.tipo, valor: c.valor, generado_por: "random", expira: new Date(Date.now()+30*86400000).toISOString().split('T')[0] }]).select().single();
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/compras
  app.post("/api/loyalty/compras", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { cliente_ref, productos, metodo_pago, cambio_monedero, cupon_id } = req.body;
      let cliente_id = null;
      let datosFiscales: any = {};
      if (cliente_ref) {
        const { data: cli } = await supabase.from("loyalty_clientes").select("id,saldo_monedero,rfc,razon_social,uso_cfdi,direccion_fiscal,codigo_postal,correo_facturacion").eq("ref", cliente_ref).single();
        if (cli) {
          cliente_id = cli.id;
          datosFiscales = {
            rfc: cleanFiscalValue(cli.rfc),
            razon_social: cleanFiscalValue(cli.razon_social),
            uso_cfdi: cleanFiscalValue(cli.uso_cfdi),
            direccion_fiscal: cleanFiscalValue(cli.direccion_fiscal),
            codigo_postal: cleanFiscalValue(cli.codigo_postal),
            correo_facturacion: cleanFiscalValue(cli.correo_facturacion)
          };
        }
      }
      const total = productos.reduce((s: number, p: any) => s + (p.precio||0)*(p.cantidad||1), 0);
      let descuento = 0;
      if (cupon_id && cliente_id) {
        const { data: cup } = await supabase.from("loyalty_cupones").select("*").eq("id", cupon_id).eq("usado", false).single();
        if (cup) {
          descuento = cup.tipo === "porcentaje" ? total*(cup.valor/100) : Math.min(cup.valor, total);
          await supabase.from("loyalty_cupones").update({ usado: true }).eq("id", cupon_id);
        }
      }
      const montoFinal = Math.max(0, total - descuento);
      if (metodo_pago === "monedero" && cliente_id) {
        const { data: cli } = await supabase.from("loyalty_clientes").select("saldo_monedero").eq("id", cliente_id).single();
        if ((cli?.saldo_monedero||0) < montoFinal) return res.status(400).json({ error: "Saldo insuficiente" });
        await supabase.from("loyalty_clientes").update({ saldo_monedero: (cli?.saldo_monedero||0)-montoFinal, updated_at: new Date().toISOString() }).eq("id", cliente_id);
      }
      if (metodo_pago === "efectivo" && cambio_monedero > 0 && cliente_id) {
        const { data: cli } = await supabase.from("loyalty_clientes").select("saldo_monedero").eq("id", cliente_id).single();
        await supabase.from("loyalty_clientes").update({ saldo_monedero: (cli?.saldo_monedero||0)+cambio_monedero, updated_at: new Date().toISOString() }).eq("id", cliente_id);
      }
      const { data: compra, error } = await supabase.from("loyalty_compras").insert([{ cliente_id, total: montoFinal, metodo_pago, cambio_monedero: cambio_monedero||0, cupon_id: cupon_id||null, descuento_aplicado: descuento, productos, estado: "completada" }]).select().single();
      if (error) throw error;
      const folio = `FAC-${new Date().getFullYear()}-${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
      await supabase.from("loyalty_facturas").insert([{ compra_id: compra.id, cliente_id, folio, total: montoFinal, subtotal: montoFinal, iva: Math.round(montoFinal*0.16*100)/100, ...datosFiscales }]);
      emitDomainEvent("compra:created", { compra_id: compra.id, cliente_id });
      res.status(201).json(compra);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref/compras
  app.get("/api/loyalty/cliente/:ref/compras", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data } = await supabase.from("loyalty_compras").select("*").eq("cliente_id", cli.id).order("created_at", { ascending: false }).limit(50);
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref/facturas
  app.get("/api/loyalty/cliente/:ref/facturas", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data } = await supabase.from("loyalty_facturas").select("*").eq("cliente_id", cli.id).order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/cliente/:ref/facturas/:id/solicitar — El cliente pide su factura desde la app
  app.post("/api/loyalty/cliente/:ref/facturas/:id/solicitar", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id,rfc,razon_social,uso_cfdi,direccion_fiscal,codigo_postal,correo_facturacion").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const rfcFiscal = cleanFiscalValue(cli.rfc);
      if (!rfcFiscal) return res.status(400).json({ error: "Completa tus datos fiscales (RFC) en Ajustes antes de solicitar la factura" });
      // Nota: loyalty_facturas NO tiene columna updated_at (solo created_at)
      const { data, error } = await supabase.from("loyalty_facturas")
        .update({
          estado: "solicitada",
          rfc: rfcFiscal, razon_social: cleanFiscalValue(cli.razon_social), uso_cfdi: cleanFiscalValue(cli.uso_cfdi),
          direccion_fiscal: cleanFiscalValue(cli.direccion_fiscal), codigo_postal: cleanFiscalValue(cli.codigo_postal),
          correo_facturacion: cleanFiscalValue(cli.correo_facturacion)
        })
        .eq("id", req.params.id)
        .eq("cliente_id", cli.id)
        .select()
        .single();
      if (error || !data) return res.status(404).json({ error: "Factura no encontrada" });
      emitDomainEvent("factura:solicitada", { factura_id: data.id, folio: data.folio });
      res.json({ success: true, folio: data.folio, rfc: data.rfc, correo_facturacion: data.correo_facturacion });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/cliente/:ref/compras/:id/solicitar-factura — Solicitar factura desde el ticket de una compra
  app.post("/api/loyalty/cliente/:ref/compras/:id/solicitar-factura", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id,rfc,razon_social,uso_cfdi,direccion_fiscal,codigo_postal,correo_facturacion").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const rfcFiscal = cleanFiscalValue(cli.rfc);
      if (!rfcFiscal) return res.status(400).json({ error: "Completa tus datos fiscales (RFC) en Ajustes antes de solicitar la factura" });
      const { data: factura } = await supabase.from("loyalty_facturas")
        .select("*")
        .eq("compra_id", req.params.id)
        .eq("cliente_id", cli.id)
        .maybeSingle();
      if (!factura) return res.status(404).json({ error: "La compra aún no tiene factura generada" });
      // Nota: loyalty_facturas NO tiene columna updated_at (solo created_at)
      const { data, error } = await supabase.from("loyalty_facturas")
        .update({
          estado: "solicitada",
          rfc: rfcFiscal, razon_social: cleanFiscalValue(cli.razon_social), uso_cfdi: cleanFiscalValue(cli.uso_cfdi),
          direccion_fiscal: cleanFiscalValue(cli.direccion_fiscal), codigo_postal: cleanFiscalValue(cli.codigo_postal),
          correo_facturacion: cleanFiscalValue(cli.correo_facturacion)
        })
        .eq("id", factura.id)
        .select()
        .single();
      if (error || !data) return res.status(500).json({ error: error?.message || "Error al solicitar factura" });
      emitDomainEvent("factura:solicitada", { factura_id: data.id, folio: data.folio });
      res.json({ success: true, folio: data.folio, rfc: data.rfc, correo_facturacion: data.correo_facturacion });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/solicitar-pago — POS → App
  app.post("/api/loyalty/solicitar-pago", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { cliente_ref, monto, concepto } = req.body;
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", cliente_ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data, error } = await supabase.from("loyalty_solicitudes_pago").insert([{ cliente_id: cli.id, monto, concepto: concepto||"Compra en AURA Boutique", estado: "pendiente", expira: new Date(Date.now()+5*60000).toISOString() }]).select().single();
      if (error) throw error;
      emitDomainEvent("pago:solicitado", { solicitud_id: data.id, cliente_ref, monto });
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/loyalty/cliente/:ref/solicitudes-pago
  app.get("/api/loyalty/cliente/:ref/solicitudes-pago", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data: cli } = await supabase.from("loyalty_clientes").select("id").eq("ref", req.params.ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      const { data } = await supabase.from("loyalty_solicitudes_pago").select("*").eq("cliente_id", cli.id).eq("estado", "pendiente").order("created_at", { ascending: false });
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/aprobar-pago
  app.post("/api/loyalty/aprobar-pago", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { solicitud_id, tarjeta_id } = req.body;
      const { data: sol } = await supabase.from("loyalty_solicitudes_pago").select("*").eq("id", solicitud_id).single();
      if (!sol) return res.status(404).json({ error: "Solicitud no encontrada" });
      if (sol.estado !== "pendiente") return res.status(400).json({ error: "Ya procesada" });
      await supabase.from("loyalty_solicitudes_pago").update({ estado: "aprobado", tarjeta_id }).eq("id", solicitud_id);
      emitDomainEvent("pago:aprobado", { solicitud_id });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/loyalty/recargar-monedero
  app.post("/api/loyalty/recargar-monedero", async (req, res) => {
    try {
      const supabase = getSupabase();
      const { cliente_ref, monto } = req.body;
      const { data: cli } = await supabase.from("loyalty_clientes").select("*").eq("ref", cliente_ref).single();
      if (!cli) return res.status(404).json({ error: "Cliente no encontrado" });
      await supabase.from("loyalty_clientes").update({ saldo_monedero: (cli.saldo_monedero||0)+monto, updated_at: new Date().toISOString() }).eq("ref", cliente_ref);
      res.json({ success: true, nuevo_saldo: (cli.saldo_monedero||0)+monto });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/app-catalog — Catálogo de apps móviles para descarga
  app.get("/api/app-catalog", async (_req, res) => {
    const apps = [
      {
        id: "alpha",
        name: "Inventorio Alpha",
        description: "Dashboard principal con escáner, OCR por lote y gestión de inventario",
        packageName: "com.inventorio.alpha",
        apkUrl: "/public/inventorio.apk",
        versionName: "2.0.82"
      },
      {
        id: "conteo",
        name: "Inventorio Conteo",
        description: "Conteo físico con eventos, niveles y cajas",
        packageName: "com.inventorio.conteo",
        apkUrl: "/public/inventorio-conteo.apk",
        versionName: "1.0.30"
      },
      {
        id: "operations",
        name: "Inventorio Operations",
        description: "Procesamiento de CSV, búsqueda en DB y operaciones de inventario",
        packageName: "com.inventorio.operations",
        apkUrl: "/public/inventorio-operations.apk",
        versionName: "1.0.19"
      },
      {
        id: "loyalty",
        name: "AURA Club (Loyalty)",
        description: "Club de lealtad con monedero electrónico, tarjetas y QR de membresía",
        packageName: "com.inventorio.loyalty",
        apkUrl: "/public/inventorio-loyalty.apk",
        versionName: "1.0.2"
      }
    ];

    // Sync versiones publicadas desde warehouse_settings (fuente única del OTA)
    try {
      const supabase = getSupabase();
      const { data: settings } = await supabase
        .from("warehouse_settings")
        .select("clave, valor")
        .in("clave", ["android_version_loyalty", "android_version_conteo", "android_version_operations", "android_version"]);
      if (settings) {
        const map: Record<string, string> = {
          android_version_loyalty: "loyalty",
          android_version_conteo: "conteo",
          android_version_operations: "operations",
          android_version: "alpha"
        };
        for (const s of settings) {
          const appId = map[s.clave];
          if (!appId) continue;
          const app = apps.find(a => a.id === appId);
          if (!app) continue;
          const info = s.valor;
          if (info?.versionName) app.versionName = String(info.versionName);
          if (info?.versionCode) (app as any).versionCode = Number(info.versionCode);
          if (info?.apkUrl) app.apkUrl = String(info.apkUrl);
        }
      }
    } catch (_) {}

    res.json(apps);
  });

  // Serve static public assets in both dev and prod
  if (fs.existsSync(path.join(process.cwd(), "public"))) {
      app.use('/public', express.static(path.join(process.cwd(), "public")));
  }

  if (NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    
    if (fs.existsSync(path.join(process.cwd(), "public"))) {
        console.log("Serving static files from /public");
        app.use('/public', express.static(path.join(process.cwd(), "public")));
    }

    // Serve static assets with cache, but disable cache for index.html
    app.use(express.static(distPath, {
      maxAge: '1d',
      setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[${NODE_ENV}] Server running on port ${PORT}`);
    if (NODE_ENV === 'production') {
      console.log('✓ Production mode enabled');
      console.log('✓ CORS configured');
      console.log('✓ Security headers applied');
    }
  });
}

startServer();
