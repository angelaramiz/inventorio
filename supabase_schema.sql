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
    has_foto BOOLEAN DEFAULT false, -- Indicador rápido para evitar peticiones 404
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
    sku VARCHAR(255) UNIQUE, -- SKU/Código de barras de la caja física
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
    c.sku,
    c.estado,
    c.fecha_creacion,
    COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
    COALESCE(SUM(cp.cantidad), 0) as total_unidades
FROM cajas c
LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
GROUP BY c.id_caja, c.numero_caja, c.sku, c.estado, c.fecha_creacion;

-- 6. Funcion para actualizar updated_at y has_foto
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_set_has_foto()
RETURNS TRIGGER AS $$
BEGIN
  NEW.has_foto = (NEW.foto IS NOT NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Triggers
CREATE TRIGGER set_has_foto_productos
BEFORE INSERT OR UPDATE ON productos
FOR EACH ROW
EXECUTE PROCEDURE trigger_set_has_foto();
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
--   ALTER TABLE temporadas DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE tipos_producto DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE zonas_almacen DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE zonas_seccion DISABLE ROW LEVEL SECURITY;
--
-- OPCIÓN B (Habilitar RLS y permitir acceso público completo):
-- Ejecuta esto en el SQL Editor de Supabase:
--
--   ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE caja_productos ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE temporadas ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE tipos_producto ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE zonas_almacen ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE zonas_seccion ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "Permitir todo a anon en cajas" ON cajas FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en productos" ON productos FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en caja_productos" ON caja_productos FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en temporadas" ON temporadas FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en tipos_producto" ON tipos_producto FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en zonas_almacen" ON zonas_almacen FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "Permitir todo a anon en zonas_seccion" ON zonas_seccion FOR ALL TO anon USING (true) WITH CHECK (true);
--
-- OPCIÓN C (Mejor práctica para servidores backend):
-- En el panel de Render, cambia el valor de la variable de entorno `SUPABASE_KEY` 
-- por la clave secreta `service_role` (que se encuentra en Supabase -> API Settings).
-- La clave `service_role` tiene permisos de administrador y salta las reglas de RLS automáticamente.

-- =========================================================================
-- 9. MIGRACIÓN PARA BASE DE DATOS EXISTENTE (Si ya la creaste antes)
-- =========================================================================
-- Ejecuta este bloque de comandos SQL en tu editor de Supabase para agregar
-- la columna 'sku' a tus cajas y actualizar la vista correspondiente:
--
-- ALTER TABLE cajas ADD COLUMN sku VARCHAR(255) UNIQUE;
--
-- DROP VIEW IF EXISTS vista_total_cajas;
-- CREATE VIEW vista_total_cajas AS
-- SELECT 
--     c.id_caja,
--     c.numero_caja,
--     c.sku,
--     c.estado,
--     c.fecha_creacion,
--     COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
--     COALESCE(SUM(cp.cantidad), 0) as total_unidades
-- FROM cajas c
-- LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
-- GROUP BY c.id_caja, c.numero_caja, c.sku, c.estado, c.fecha_creacion;

-- MIGRACIÓN 2: AGREGAR HAS_FOTO E INSTALAR TRIGGER AUTOMÁTICO EN PRODUCTOS
-- Si ya tienes la base de datos creada, ejecuta esto en el SQL Editor de Supabase:
--
-- ALTER TABLE productos ADD COLUMN has_foto BOOLEAN DEFAULT false;
-- UPDATE productos SET has_foto = true WHERE foto IS NOT NULL;
--
-- CREATE OR REPLACE FUNCTION trigger_set_has_foto()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.has_foto = (NEW.foto IS NOT NULL);
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- CREATE OR REPLACE TRIGGER set_has_foto_productos
-- BEFORE INSERT OR UPDATE ON productos
-- FOR EACH ROW
-- EXECUTE PROCEDURE trigger_set_has_foto();
-- MIGRACIÓN 3: CONVERTIR COLUMNAS A TEXTO DINÁMICO Y CREAR TABLAS DE CONCEPTOS DINÁMICOS
-- Ejecuta esto en el SQL Editor de Supabase para poder agregar/eliminar temporadas y tipos dinámicamente:
--
-- ALTER TABLE productos ALTER COLUMN temporada DROP DEFAULT;
-- ALTER TABLE productos ALTER COLUMN temporada TYPE VARCHAR(100);
-- ALTER TABLE productos ALTER COLUMN temporada SET DEFAULT 'todouso';
--
-- ALTER TABLE productos ALTER COLUMN tipo DROP DEFAULT;
-- ALTER TABLE productos ALTER COLUMN tipo TYPE VARCHAR(100);
-- ALTER TABLE productos ALTER COLUMN tipo SET DEFAULT 'otro';
--
-- CREATE TABLE IF NOT EXISTS temporadas (
--     nombre VARCHAR(100) PRIMARY KEY
-- );
--
-- CREATE TABLE IF NOT EXISTS tipos_producto (
--     nombre VARCHAR(100) PRIMARY KEY
-- );
--
-- INSERT INTO temporadas (nombre) VALUES ('verano'), ('invierno'), ('entretiempo'), ('todouso') ON CONFLICT DO NOTHING;
-- INSERT INTO tipos_producto (nombre) VALUES ('pantalon'), ('accesorio'), ('camisa'), ('calzado'), ('chaqueta'), ('otro') ON CONFLICT DO NOTHING;

-- MIGRACIÓN 4: UBICACIONES DE ALMACÉN Y SECCIONES
-- Ejecuta esto en el SQL Editor de Supabase:
--
-- CREATE TABLE IF NOT EXISTS zonas_almacen (
--     id_zona_almacen SERIAL PRIMARY KEY,
--     nombre VARCHAR(100) UNIQUE NOT NULL
-- );
--
-- CREATE TABLE IF NOT EXISTS zonas_seccion (
--     id_zona_seccion SERIAL PRIMARY KEY,
--     nombre VARCHAR(100) NOT NULL,
--     id_zona_almacen INT REFERENCES zonas_almacen(id_zona_almacen) ON DELETE CASCADE,
--     UNIQUE(nombre, id_zona_almacen)
-- );
--
-- -- Poblar zonas de almacén por defecto
-- INSERT INTO zonas_almacen (nombre) VALUES 
-- ('bodega superior'), 
-- ('bodega inferior'), 
-- ('piso venta'), 
-- ('zona pos'), 
-- ('probadores')
-- ON CONFLICT (nombre) DO NOTHING;
--
-- -- Agregar columna de sección y almacén directo a cajas
-- ALTER TABLE cajas ADD COLUMN IF NOT EXISTS id_zona_seccion INT REFERENCES zonas_seccion(id_zona_seccion) ON DELETE SET NULL;
-- ALTER TABLE cajas ADD COLUMN IF NOT EXISTS id_zona_almacen INT REFERENCES zonas_almacen(id_zona_almacen) ON DELETE SET NULL;
--
-- -- Recrear la vista de cajas para incluir la sección y almacén de forma dinámica
-- DROP VIEW IF EXISTS vista_total_cajas;
-- CREATE VIEW vista_total_cajas AS
-- SELECT 
--     c.id_caja,
--     c.numero_caja,
--     c.sku,
--     c.estado,
--     c.fecha_creacion,
--     c.id_zona_seccion,
--     zs.nombre as seccion_nombre,
--     COALESCE(c.id_zona_almacen, zs.id_zona_almacen) as id_zona_almacen,
--     COALESCE(za_direct.nombre, za_sec.nombre) as almacen_nombre,
--     COUNT(DISTINCT cp.id_producto) as total_productos_unicos,
--     COALESCE(SUM(cp.cantidad), 0) as total_unidades
-- FROM cajas c
-- LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
-- LEFT JOIN zonas_seccion zs ON c.id_zona_seccion = zs.id_zona_seccion
-- LEFT JOIN zonas_almacen za_sec ON zs.id_zona_almacen = za_sec.id_zona_almacen
-- LEFT JOIN zonas_almacen za_direct ON c.id_zona_almacen = za_direct.id_zona_almacen
-- GROUP BY c.id_caja, c.numero_caja, c.sku, c.estado, c.fecha_creacion, c.id_zona_seccion, zs.nombre, c.id_zona_almacen, zs.id_zona_almacen, za_direct.nombre, za_sec.nombre;
--
-- -- IMPORTANTE: Desactivar RLS si estás usando la API anon pública sin políticas restrictivas
-- ALTER TABLE zonas_almacen DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE zonas_seccion DISABLE ROW LEVEL SECURITY;

-- MIGRACIÓN 5: SUB MARCAS DINÁMICAS
-- Ejecuta esto en el SQL Editor de Supabase:
--
-- CREATE TABLE IF NOT EXISTS sub_marcas (
--     nombre VARCHAR(100) PRIMARY KEY
-- );
--
-- INSERT INTO sub_marcas (nombre) VALUES ('Guess'), ('Marciano'), ('GuessEco') ON CONFLICT DO NOTHING;
-- ALTER TABLE sub_marcas DISABLE ROW LEVEL SECURITY;

