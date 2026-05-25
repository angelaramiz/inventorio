-- Migraciones de Base de Datos para las Nuevas Características (Fases 1, 2 y 3)
-- Ejecutar este bloque de comandos SQL en el SQL Editor de tu Dashboard de Supabase.

-- =========================================================================
-- FASE 1: JERARQUÍA DE ALMACENAMIENTO, AJUSTES Y STOCK EN TIEMPO REAL
-- =========================================================================

-- 1. Tabla de jerarquía de almacenamiento
CREATE TABLE IF NOT EXISTS storage_hierarchy (
    id SERIAL PRIMARY KEY,
    parent_id INT REFERENCES storage_hierarchy(id) ON DELETE CASCADE,
    tipo_almacen VARCHAR(50) NOT NULL, -- 'bodega', 'estante', 'caja', 'perchero', etc.
    sku_asociado VARCHAR(255) REFERENCES productos(sku) ON DELETE SET NULL,
    codigo_barras VARCHAR(255) UNIQUE NOT NULL,
    stock_real INT DEFAULT 0 CHECK (stock_real >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indices para optimizar búsquedas por jerarquía y códigos
CREATE INDEX IF NOT EXISTS idx_sh_parent_id ON storage_hierarchy(parent_id);
CREATE INDEX IF NOT EXISTS idx_sh_codigo_barras ON storage_hierarchy(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_sh_sku_asociado ON storage_hierarchy(sku_asociado);

-- Desactivar RLS por defecto para facilitar pruebas rápidas (versión Alpha)
ALTER TABLE storage_hierarchy DISABLE ROW LEVEL SECURITY;

-- 2. Tabla de configuraciones y ajustes de almacén
CREATE TABLE IF NOT EXISTS warehouse_settings (
    clave VARCHAR(100) PRIMARY KEY,
    valor JSONB NOT NULL
);

ALTER TABLE warehouse_settings DISABLE ROW LEVEL SECURITY;

-- Insertar valores predeterminados para prefijos y secuencias de contenedores
INSERT INTO warehouse_settings (clave, valor) VALUES 
('prefijos', '{"caja": "CJ", "estante": "EST", "perchero": "PER", "bodega": "BOD"}'::jsonb),
('secuencias', '{"caja": 1, "estante": 1, "perchero": 1, "bodega": 1}'::jsonb),
('tipos_contenedor', '["caja", "estante", "perchero", "bodega"]'::jsonb)
ON CONFLICT (clave) DO NOTHING;


-- =========================================================================
-- FASE 2: GESTIÓN DE CAJAS CJ-X Y FLUJOS POS
-- =========================================================================

-- 1. Tabla de contenedores de cajas CJ-X
CREATE TABLE IF NOT EXISTS containers (
    id SERIAL PRIMARY KEY,
    prefijo VARCHAR(50) NOT NULL,
    secuencia INT NOT NULL,
    sku_validado VARCHAR(255) REFERENCES productos(sku) ON DELETE CASCADE,
    estado VARCHAR(50) NOT NULL DEFAULT 'vacia', -- 'vacia', 'activa', 'llena', 'vieja', 'rota'
    stock_heredado JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(prefijo, secuencia)
);

CREATE INDEX IF NOT EXISTS idx_containers_sku ON containers(sku_validado);

ALTER TABLE containers DISABLE ROW LEVEL SECURITY;

-- 2. Tabla de ventas para el Punto de Venta (POS)
CREATE TABLE IF NOT EXISTS ventas (
    id SERIAL PRIMARY KEY,
    vendedor_id VARCHAR(100) NOT NULL,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total DECIMAL(10, 2) NOT NULL DEFAULT 0.00
);

-- 3. Tabla relacional de detalles de venta
CREATE TABLE IF NOT EXISTS venta_detalles (
    id SERIAL PRIMARY KEY,
    venta_id INT REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INT REFERENCES productos(id_producto) ON DELETE CASCADE,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(10, 2) NOT NULL DEFAULT 0.00
);

ALTER TABLE ventas DISABLE ROW LEVEL SECURITY;
ALTER TABLE venta_detalles DISABLE ROW LEVEL SECURITY;


-- =========================================================================
-- FASE 3: FLUJO DE INVENTARIADO Y APROBACIONES GERENCIALES
-- =========================================================================

-- 1. Eventos de inventario (agenda gerencial)
CREATE TABLE IF NOT EXISTS inventory_events (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    estado VARCHAR(50) NOT NULL DEFAULT 'programado', -- 'programado', 'en_progreso', 'completado'
    descripcion TEXT
);

-- 2. Solicitudes de conteo de operadores
CREATE TABLE IF NOT EXISTS count_requests (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES inventory_events(id) ON DELETE CASCADE,
    operator_id VARCHAR(100) NOT NULL,
    zone_id INT, -- Referencia a zona de la jerarquía o zona de almacén antigua
    cantidades JSONB NOT NULL, -- Formato: { "id_producto": cantidad }
    estado VARCHAR(50) NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'aprobado', 'rechazado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Aprobación gerencial de conteos
CREATE TABLE IF NOT EXISTS approvals (
    id SERIAL PRIMARY KEY,
    request_id INT REFERENCES count_requests(id) ON DELETE CASCADE,
    manager_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'aprobado', 'rechazado'
    comentarios TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Registro final consolidado de unidades contadas
CREATE TABLE IF NOT EXISTS counts (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES inventory_events(id) ON DELETE CASCADE,
    producto_id INT REFERENCES productos(id_producto) ON DELETE CASCADE,
    zona_id INT,
    cantidad_final INT NOT NULL CHECK (cantidad_final >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE inventory_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE count_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE approvals DISABLE ROW LEVEL SECURITY;
ALTER TABLE counts DISABLE ROW LEVEL SECURITY;

-- Triggers de timestamp automáticos
CREATE OR REPLACE TRIGGER set_timestamp_storage_hierarchy
BEFORE UPDATE ON storage_hierarchy
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

CREATE OR REPLACE TRIGGER set_timestamp_containers
BEFORE UPDATE ON containers
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
