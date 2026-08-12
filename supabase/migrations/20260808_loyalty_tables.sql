-- ============================================================
-- FIELCLUB / LOYALTY — Tablas para sistema de lealtad + wallet
-- ============================================================

-- 1. CLIENTES
CREATE TABLE IF NOT EXISTS loyalty_clientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ref TEXT UNIQUE NOT NULL,                    -- FIEL-XXXXXX (código único QR)
  nombre TEXT NOT NULL,
  correo TEXT,
  telefono TEXT,
  cumple DATE,
  saldo_monedero NUMERIC DEFAULT 0,            -- Dinero electrónico
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TARJETAS BANCARIAS (simulación)
CREATE TABLE IF NOT EXISTS loyalty_tarjetas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES loyalty_clientes(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,                         -- "BBVA Débito", "Santander Crédito"
  ultimos_digitos TEXT NOT NULL,               -- "4242"
  tipo TEXT DEFAULT 'debito',                  -- debito / credito
  banco TEXT,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CUPONES
CREATE TABLE IF NOT EXISTS loyalty_cupones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES loyalty_clientes(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL,                          -- porcentaje / fijo / envio_gratis
  valor NUMERIC NOT NULL,                      -- 20 = 20% o 200 = $200
  minimo_compra NUMERIC DEFAULT 0,
  usado BOOLEAN DEFAULT false,
  usado_en UUID,                               -- ID de la compra donde se usó
  expira DATE,
  generado_por TEXT DEFAULT 'cumpleaños',       -- cumpleaños / random / manual
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. COMPRAS (registro de ventas)
CREATE TABLE IF NOT EXISTS loyalty_compras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES loyalty_clientes(id),
  total NUMERIC NOT NULL,
  metodo_pago TEXT NOT NULL,                   -- efectivo / monedero / tarjeta / mixto
  cambio_monedero NUMERIC DEFAULT 0,           -- Cambio en efectivo → monedero
  cupon_id UUID REFERENCES loyalty_cupones(id),
  descuento_aplicado NUMERIC DEFAULT 0,
  productos JSONB NOT NULL,                    -- [{ sku, modelo, talla, cantidad, precio }]
  estado TEXT DEFAULT 'completada',            -- completada / pendiente_pago / cancelada
  comprobante_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. FACTURAS (generadas post-venta)
CREATE TABLE IF NOT EXISTS loyalty_facturas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  compra_id UUID REFERENCES loyalty_compras(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES loyalty_clientes(id),
  folio TEXT UNIQUE NOT NULL,                  -- FAC-2026-XXXX
  total NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL,
  iva NUMERIC DEFAULT 0,
  estado TEXT DEFAULT 'emitida',
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. SOLICITUDES DE PAGO (POS → App)
CREATE TABLE IF NOT EXISTS loyalty_solicitudes_pago (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID REFERENCES loyalty_clientes(id),
  compra_id UUID REFERENCES loyalty_compras(id),
  monto NUMERIC NOT NULL,
  concepto TEXT,                               -- "Compra en Boutique AURA"
  estado TEXT DEFAULT 'pendiente',             -- pendiente / aprobado / rechazado / expirado
  tarjeta_id UUID REFERENCES loyalty_tarjetas(id),
  expira TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_lc_ref ON loyalty_clientes(ref);
CREATE INDEX IF NOT EXISTS idx_lc_correo ON loyalty_clientes(correo);
CREATE INDEX IF NOT EXISTS idx_lt_cliente ON loyalty_tarjetas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lcup_cliente ON loyalty_cupones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lcomp_cliente ON loyalty_compras(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lfact_cliente ON loyalty_facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lsol_cliente ON loyalty_solicitudes_pago(cliente_id);
CREATE INDEX IF NOT EXISTS idx_lsol_estado ON loyalty_solicitudes_pago(estado);

-- ============================================================
-- CLIENTE DEMO (para pruebas)
-- ============================================================
INSERT INTO loyalty_clientes (ref, nombre, correo, telefono, cumple, saldo_monedero)
VALUES ('FIEL-DEMO001', 'María García López', 'maria@test.com', '5512345678', '1995-06-15', 500)
ON CONFLICT (ref) DO NOTHING;

-- Cupones demo para el cliente
INSERT INTO loyalty_cupones (cliente_id, codigo, descripcion, tipo, valor, expira, generado_por)
SELECT id, 'CUMPLE-2026', '20% OFF por tu cumpleaños', 'porcentaje', 20, '2026-12-31', 'cumpleaños'
FROM loyalty_clientes WHERE ref = 'FIEL-DEMO001'
ON CONFLICT DO NOTHING;

INSERT INTO loyalty_cupones (cliente_id, codigo, descripcion, tipo, valor, expira, generado_por)
SELECT id, 'BIENVENIDA', '$200 de descuento en tu primera compra', 'fijo', 200, '2026-12-31', 'bienvenida'
FROM loyalty_clientes WHERE ref = 'FIEL-DEMO001'
ON CONFLICT DO NOTHING;

-- Tarjeta demo para el cliente
INSERT INTO loyalty_tarjetas (cliente_id, alias, ultimos_digitos, tipo, banco)
SELECT id, 'BBVA Débito', '4242', 'debito', 'BBVA'
FROM loyalty_clientes WHERE ref = 'FIEL-DEMO001'
ON CONFLICT DO NOTHING;
