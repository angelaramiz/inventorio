-- Esquema de Base de Datos para Sistema de Gestion de Inventario y Cajas

-- 1. Tipos Enum
CREATE TYPE temporada_enum AS ENUM ('verano', 'invierno', 'entretiempo', 'todouso');
CREATE TYPE tipo_producto_enum AS ENUM ('pantalon', 'accesorio', 'camisa', 'calzado', 'chaqueta', 'otro');
CREATE TYPE estado_caja_enum AS ENUM ('vacia', 'activa', 'llena');

-- 2. Tabla Productos
CREATE TABLE productos (
    id_producto SERIAL PRIMARY KEY,
    sku VARCHAR(255) UNIQUE NOT NULL,
    ean_13 VARCHAR(13) UNIQUE,
    talla VARCHAR(50),
    temporada temporada_enum DEFAULT 'todouso',
    tipo tipo_producto_enum DEFAULT 'otro',
    marca_sub VARCHAR(255),
    foto BYTEA, -- Almacenamiento binario optimizado
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_productos_sku ON productos(sku);
CREATE INDEX idx_productos_ean13 ON productos(ean_13);
CREATE INDEX idx_productos_activo ON productos(activo);

-- 3. Tabla Cajas
CREATE TABLE cajas (
    id_caja SERIAL PRIMARY KEY,
    numero_caja VARCHAR(50) UNIQUE NOT NULL,
    estado estado_caja_enum NOT NULL DEFAULT 'vacia',
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabla Relacional Caja-Productos
CREATE TABLE caja_productos (
    id_relacion SERIAL PRIMARY KEY,
    id_caja INT REFERENCES cajas(id_caja) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id_producto) ON DELETE CASCADE,
    cantidad INT DEFAULT 1 CHECK (cantidad > 0),
    fecha_ingreso TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(id_caja, id_producto)
);

CREATE INDEX idx_cp_id_caja ON caja_productos(id_caja);
CREATE INDEX idx_cp_id_producto ON caja_productos(id_producto);

-- 5. Vista de Inventario Total por Caja
CREATE OR REPLACE VIEW vista_total_cajas AS
SELECT 
    c.id_caja,
    c.numero_caja,
    c.estado,
    c.fecha_creacion,
    COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
    COALESCE(SUM(cp.cantidad), 0) as total_unidades
FROM cajas c
LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
GROUP BY c.id_caja, c.numero_caja, c.estado, c.fecha_creacion;

-- 6. Funcion para actualizar updated_at
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Triggers
CREATE TRIGGER set_timestamp_productos
BEFORE UPDATE ON productos
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

CREATE TRIGGER set_timestamp_cajas
BEFORE UPDATE ON cajas
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_timestamp();

-- =========================================================================
-- 8. SEGURIDAD Y POLÍTICAS DE ACCESO (Row Level Security - RLS)
-- =========================================================================
-- Por defecto, Supabase activa RLS en las tablas nuevas. Si la aplicación no 
-- utiliza autenticación de usuarios (como esta versión Alpha), las consultas 
-- del servidor Express usando la clave pública (anon key) fallarán con error 500
-- ("new row violates row-level security policy").
--
-- Tienes tres opciones para solucionar esto en la Consola de Supabase:
--
-- OPCIÓN A (Recomendada - Deshabilitar RLS por completo para uso interno/Alpha):
-- Ejecuta esto en el SQL Editor de Supabase:
--
--   ALTER TABLE cajas DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE productos DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE caja_productos DISABLE ROW LEVEL SECURITY;
--
-- OPCIÓN B (Habilitar RLS y permitir acceso público completo):
-- Ejecuta esto en el SQL Editor de Supabase:
--
--   ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE caja_productos ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "Permitir todo a anon en cajas" ON cajas FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en productos" ON productos FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en caja_productos" ON caja_productos FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- OPCIÓN C (Mejor práctica para servidores backend):
-- En el panel de Render, cambia el valor de la variable de entorno `SUPABASE_KEY` 
-- por la clave secreta `service_role` (que se encuentra en Supabase -> API Settings).
-- La clave `service_role` tiene permisos de administrador y salta las reglas de RLS automáticamente.

