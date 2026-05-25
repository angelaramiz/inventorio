import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import multer from "multer";
import { EventEmitter } from "events";

// In-memory event emitter for real-time stock updates
const stockEvents = new EventEmitter();
stockEvents.setMaxListeners(100);

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
  limits: { fileSize: 200 * 1024 } // 200KB limit
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

// --- HEALTH CHECK ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// --- API ROUTES ---

// GET /api/productos - EXCLUDING foto column for performance. Supports ?q, ?marca, ?talla, ?temporada, ?tipo filters
app.get("/api/productos", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { q, marca, talla, temporada, tipo } = req.query as Record<string, string>;
    
    let query = supabase
      .from("productos")
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at")
      .order("created_at", { ascending: false });
    
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
    
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/productos - Supporting multipart/form-data for binary capture
app.post("/api/productos", upload.single('foto'), async (req, res) => {
  try {
    const supabase = getSupabase();
    let { sku, ean_13, talla, temporada, tipo, marca_sub } = req.body;
    
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
    
    const foto = req.file ? '\\x' + req.file.buffer.toString('hex') : null;
    
    const { data, error } = await supabase
      .from("productos")
      .insert([{ sku, ean_13, talla, temporada, tipo, marca_sub, foto }])
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at");
    
    if (error) throw error;
    res.json(data[0]);
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

// POST /api/cajas
app.post("/api/cajas", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { numero_caja, id_zona_seccion, id_zona_almacen, temporada_default, tags } = req.body;
    
    numero_caja = sanitizeIdentifier(numero_caja, 50);
    if (!numero_caja) {
      return res.status(400).json({ error: "El número de caja es requerido y debe ser válido" });
    }
    
    const insertData: any = { numero_caja, estado: 'vacia' };
    if (id_zona_seccion !== undefined && id_zona_seccion !== null && id_zona_seccion !== "") {
      const parsedSec = parseInt(id_zona_seccion);
      if (isNaN(parsedSec) || parsedSec <= 0) {
        return res.status(400).json({ error: "ID de sección inválido" });
      }
      insertData.id_zona_seccion = parsedSec;
      insertData.id_zona_almacen = null;
    } else if (id_zona_almacen !== undefined && id_zona_almacen !== null && id_zona_almacen !== "") {
      const parsedAlm = parseInt(id_zona_almacen);
      if (isNaN(parsedAlm) || parsedAlm <= 0) {
        return res.status(400).json({ error: "ID de almacén inválido" });
      }
      insertData.id_zona_almacen = parsedAlm;
      insertData.id_zona_seccion = null;
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
    const { estado, sku, id_zona_seccion, id_zona_almacen, temporada_default, tags } = req.body;
    
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
    }
    if (id_zona_seccion !== undefined && id_zona_seccion !== null && id_zona_seccion !== "") {
      const parsedSec = parseInt(id_zona_seccion);
      if (isNaN(parsedSec) || parsedSec <= 0) {
        return res.status(400).json({ error: "ID de sección inválido" });
      }
      updateData.id_zona_seccion = parsedSec;
      updateData.id_zona_almacen = null;
    } else if (id_zona_almacen !== undefined && id_zona_almacen !== null && id_zona_almacen !== "") {
      const parsedAlm = parseInt(id_zona_almacen);
      if (isNaN(parsedAlm) || parsedAlm <= 0) {
        return res.status(400).json({ error: "ID de almacén inválido" });
      }
      updateData.id_zona_almacen = parsedAlm;
      updateData.id_zona_seccion = null;
    } else if (id_zona_seccion === null || id_zona_almacen === null) {
      updateData.id_zona_seccion = null;
      updateData.id_zona_almacen = null;
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
    res.json({ success: true, message: "Caja eliminada correctamente", deleted: data[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/verificar/:ean
app.get("/api/verificar/:ean", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { ean } = req.params;
    
    // 1. Buscar producto por EAN o SKU
    const { data: product, error: pError } = await supabase
      .from("productos")
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at")
      .or(`ean_13.eq.${ean},sku.eq.${ean}`)
      .single();
    
    if (pError) {
      if (pError.code === 'PGRST116') {
        return res.json({ exists: false });
      }
      throw pError;
    }
    
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
      .eq("id_producto", product.id_producto);
    
    if (uError) throw uError;
    
    const ubicacionActiva = ubicaciones?.find((u: any) => u.cajas.estado !== 'vacia');
    
    res.json({
      exists: true,
      product,
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
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cajas/:id/productos
app.get("/api/cajas/:id/productos", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from("caja_productos")
      .select(`
        id_producto,
        cantidad,
        productos (id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at)
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

// PUT /api/productos/:id - Editing product info and/or photo
app.put("/api/productos/:id", upload.single('foto'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de producto inválido" });
    }
    let { sku, ean_13, talla, temporada, tipo, marca_sub, delete_foto } = req.body;
    
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
    
    if (req.file) {
      updateData.foto = '\\x' + req.file.buffer.toString('hex');
    } else if (delete_foto === 'true') {
      updateData.foto = null;
    }
    
    const { data, error } = await supabase
      .from("productos")
      .update(updateData)
      .eq("id_producto", id)
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at");
      
    if (error) throw error;
    res.json(data[0]);
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
    
    const { error } = await supabase
      .from("productos")
      .delete()
      .eq("id_producto", id);
      
    if (error) throw error;
    res.json({ success: true });
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

// GET /api/consultar-producto/:query - Query boxes containing a specific product by SKU or EAN-13
app.get("/api/consultar-producto/:query", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { query } = req.params;
    
    // Find the product by SKU or EAN-13
    const { data: product, error: pErr } = await supabase
      .from("productos")
      .select("*")
      .or(`sku.eq.${query},ean_13.eq.${query}`)
      .maybeSingle();
      
    if (pErr) throw pErr;
    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado en el sistema" });
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
          seccion_nombre: seccion ? seccion.nombre : null,
          almacen_nombre: almacen ? almacen.nombre : null
        }
      };
    });
    
    res.json({
      product,
      boxes: resultBoxes
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/transferir-producto - Transfer quantity of a product between boxes
app.post("/api/transferir-producto", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id_caja_origen, id_caja_destino, id_producto, cantidad } = req.body;
    
    if (!id_caja_origen || !id_caja_destino || !id_producto || !cantidad || cantidad <= 0) {
      return res.status(400).json({ error: "Faltan parámetros requeridos o la cantidad es inválida" });
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
    
    res.json({ success: true });
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
    const { items, vendedor_id = "Vendedor General" } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "El carrito está vacío" });
    }
    
    // 1. Crear Registro de Salida (precio/total = 0.00 ya que no es venta comercial)
    const { data: sale, error: sErr } = await supabase
      .from("ventas")
      .insert([{ vendedor_id, total: 0.00 }])
      .select();
      
    if (sErr || !sale) throw sErr;
    const saleId = sale[0].id;
    
    // 2. Guardar Detalles y descontar stock
    for (const item of items) {
      await supabase
        .from("venta_detalles")
        .insert([{
          venta_id: saleId,
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
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/inventory/events - Create inventory event
app.post("/api/inventory/events", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { descripcion, fecha } = req.body;
    
    const { data, error } = await supabase
      .from("inventory_events")
      .insert([{
        descripcion,
        fecha: fecha ? new Date(fecha) : new Date(),
        estado: "programado"
      }])
      .select();
      
    if (error) throw error;
    res.json(data[0]);
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
    const { event_id, operator_id, zone_id, cantidades, zone_name } = req.body;
    
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

// GET /api/inventory/count-requests - List all count requests
app.get("/api/inventory/count-requests", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("count_requests")
      .select("*")
      .order("created_at", { ascending: false });
      
    if (error) throw error;
    res.json(data);
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
      
    if (status === "aprobado" && request) {
      const cantidades = request.cantidades;
      const event_id = request.event_id;
      const zone_id = request.zone_id;
      
      for (const [prodIdStr, qty] of Object.entries(cantidades)) {
        const prodId = parseInt(prodIdStr);
        const quantity = parseInt(qty as any);
        
        await supabase
          .from("counts")
          .insert([{
            event_id,
            producto_id: prodId,
            zona_id: zone_id,
            cantidad_final: quantity
          }]);
          
        // 4. Update actual stock inside the zone/box
        const { data: box } = await supabase.from("cajas").select("id_caja").eq("id_caja", zone_id).maybeSingle();
        if (box) {
          if (quantity === 0) {
            await supabase.from("caja_productos").delete().eq("id_caja", zone_id).eq("id_producto", prodId);
          } else {
            await supabase.from("caja_productos").upsert({
              id_caja: zone_id,
              id_producto: prodId,
              cantidad: quantity
            }, { onConflict: "id_caja,id_producto" });
          }
        }
      }
      
      // Update inventory event status to completed
      await supabase
        .from("inventory_events")
        .update({ estado: "completado" })
        .eq("id", event_id);
    }
    
    res.json({ success: true });
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

// DELETE /api/almacen/secciones/:id - Delete section zone
app.delete("/api/almacen/secciones/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "ID de sección inválido" });
    }
    
    const { error } = await supabase
      .from("zonas_seccion")
      .delete()
      .eq("id_zona_seccion", id);
      
    if (error) throw error;
    res.json({ success: true });
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

  if (NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { maxAge: '1d' }));
    app.get("*", (req, res) => {
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
