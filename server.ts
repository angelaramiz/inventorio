import express from "express";
import path from "path";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import multer from "multer";

// Load env vars based on NODE_ENV
if (process.env.NODE_ENV !== 'production') {
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

// GET /api/productos - EXCLUDING foto column for performance
app.get("/api/productos", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("productos")
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, has_foto, activo, created_at")
      .order("created_at", { ascending: false });
    
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
    
    const foto = req.file ? req.file.buffer : null;
    
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

    // data.foto comes as a base64 string from PostgREST when column is BYTEA
    const buffer = Buffer.from(data.foto, 'base64');
    
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
    const { data, error } = await supabase
      .from("vista_total_cajas")
      .select("*")
      .order("fecha_creacion", { ascending: false });
    
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
    let { numero_caja, id_zona_seccion, id_zona_almacen } = req.body;
    
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
    const { estado, sku, id_zona_seccion, id_zona_almacen } = req.body;
    
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
    if (id_zona_seccion !== undefined) {
      if (id_zona_seccion === "" || id_zona_seccion === null) {
        updateData.id_zona_seccion = null;
      } else {
        const parsedSec = parseInt(id_zona_seccion);
        if (isNaN(parsedSec) || parsedSec <= 0) {
          return res.status(400).json({ error: "ID de sección inválido" });
        }
        updateData.id_zona_seccion = parsedSec;
        updateData.id_zona_almacen = null;
      }
    }
    if (id_zona_almacen !== undefined) {
      if (id_zona_almacen === "" || id_zona_almacen === null) {
        updateData.id_zona_almacen = null;
      } else {
        const parsedAlm = parseInt(id_zona_almacen);
        if (isNaN(parsedAlm) || parsedAlm <= 0) {
          return res.status(400).json({ error: "ID de almacén inválido" });
        }
        updateData.id_zona_almacen = parsedAlm;
        updateData.id_zona_seccion = null;
      }
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
    const { id_producto, cantidad = 1, force = false } = req.body;
    
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
        productos (id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, activo, created_at)
      `)
      .eq("id_caja", id);
    
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
      updateData.foto = req.file.buffer;
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
        zonas_almacen (nombre)
      `)
      .order("nombre", { ascending: true });
      
    if (sErr) throw sErr;
    
    const result = (sections || []).map((s: any) => ({
      id_zona_seccion: s.id_zona_seccion,
      nombre: s.nombre,
      id_zona_almacen: s.id_zona_almacen,
      almacen_nombre: s.zonas_almacen ? s.zonas_almacen.nombre : "Sin almacén"
    }));
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/almacen/secciones - Create section zone
app.post("/api/almacen/secciones", async (req, res) => {
  try {
    const supabase = getSupabase();
    let { nombre, id_zona_almacen } = req.body;
    nombre = sanitizeIdentifier(nombre, 50);
    if (!nombre) {
      return res.status(400).json({ error: "El nombre de sección es requerido y debe ser válido" });
    }
    
    const parsedAlm = parseInt(id_zona_almacen);
    if (isNaN(parsedAlm) || parsedAlm <= 0) {
      return res.status(400).json({ error: "La zona de almacén es requerida e inválida" });
    }
    
    const cleanNombre = nombre.toLowerCase();
    const { data, error } = await supabase
      .from("zonas_seccion")
      .insert([{ nombre: cleanNombre, id_zona_almacen: parsedAlm }])
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
