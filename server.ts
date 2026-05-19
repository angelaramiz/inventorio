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
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, activo, created_at")
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
    const { sku, ean_13, talla, temporada, tipo, marca_sub } = req.body;
    
    // Convert buffer to base64 for PostgREST BYTEA insertion if needed, 
    // or just pass buffer if supported. Supabase JS handles Buffer.
    const foto = req.file ? req.file.buffer : null;
    
    const { data, error } = await supabase
      .from("productos")
      .insert([{ sku, ean_13, talla, temporada, tipo, marca_sub, foto }])
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, activo, created_at");
    
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
    const { numero_caja } = req.body;
    
    const { data, error } = await supabase
      .from("cajas")
      .insert([{ numero_caja, estado: 'vacia' }])
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
    const { id } = req.params;
    const { estado, sku } = req.body;
    
    const updateData: any = {};
    if (estado !== undefined) updateData.estado = estado;
    if (sku !== undefined) {
      // Allow empty string to clear the SKU, or convert to trimmed string
      updateData.sku = sku.trim() === "" ? null : sku.trim();
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
      .select("id_producto, sku, ean_13, talla, temporada, tipo, marca_sub, activo, created_at")
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
    
    // 2. Asignar (Upsert)
    const { error: aError } = await supabase
      .from("caja_productos")
      .upsert({ id_caja, id_producto, cantidad }, { onConflict: 'id_caja,id_producto' });
    
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
