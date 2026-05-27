-- Script de migración de base de datos para la Jerarquía de 6 Niveles
-- Ejecuta este código en el Editor SQL de tu panel de Supabase

-- 1. Crear tabla zonas_nivel (Nivel 4)
CREATE TABLE IF NOT EXISTS zonas_nivel (
  id_zona_nivel SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  id_zona_seccion INTEGER REFERENCES zonas_seccion(id_zona_seccion) ON DELETE CASCADE,
  tags JSONB DEFAULT '{"marca": "todos", "genero": "todos", "tipo_producto": "todos"}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Agregar columna id_zona_nivel a la tabla cajas (Nivel 5)
ALTER TABLE cajas ADD COLUMN IF NOT EXISTS id_zona_nivel INTEGER REFERENCES zonas_nivel(id_zona_nivel) ON DELETE SET NULL;

-- 3. Crear o reemplazar la vista vista_total_cajas para resolver la jerarquía completa
DROP VIEW IF EXISTS vista_total_cajas CASCADE;
CREATE VIEW vista_total_cajas AS
SELECT 
  c.id_caja,
  c.numero_caja,
  c.sku,
  c.estado,
  c.fecha_creacion,
  c.updated_at,
  c.temporada_default,
  c.tags,
  -- Claves foráneas
  c.id_zona_nivel,
  COALESCE(c.id_zona_seccion, n.id_zona_seccion) AS id_zona_seccion,
  COALESCE(s.id_zona_pasillo, n_sec.id_zona_pasillo) AS id_zona_pasillo,
  COALESCE(c.id_zona_almacen, s.id_zona_almacen, n_sec.id_zona_almacen, p.id_zona_almacen, n_pas.id_zona_almacen) AS id_zona_almacen,
  -- Nombres de ubicación
  n.nombre AS nivel_nombre,
  COALESCE(s.nombre, n_sec.nombre) AS seccion_nombre,
  COALESCE(p.nombre, n_pas.nombre) AS pasillo_nombre,
  COALESCE(a.nombre, n_alm.nombre) AS almacen_nombre,
  -- Agregados de producto
  COALESCE(COUNT(DISTINCT cp.id_producto), 0)::INTEGER AS total_productos_unicos,
  COALESCE(SUM(cp.cantidad), 0)::INTEGER AS total_unidades
FROM cajas c
LEFT JOIN zonas_nivel n ON c.id_zona_nivel = n.id_zona_nivel
LEFT JOIN zonas_seccion s ON c.id_zona_seccion = s.id_zona_seccion
LEFT JOIN zonas_seccion n_sec ON n.id_zona_seccion = n_sec.id_zona_seccion
LEFT JOIN zonas_pasillo p ON s.id_zona_pasillo = p.id_zona_pasillo
LEFT JOIN zonas_pasillo n_pas ON n_sec.id_zona_pasillo = n_pas.id_zona_pasillo
LEFT JOIN zonas_almacen a ON COALESCE(s.id_zona_almacen, p.id_zona_almacen, c.id_zona_almacen) = a.id_zona_almacen
LEFT JOIN zonas_almacen n_alm ON COALESCE(n_sec.id_zona_almacen, n_pas.id_zona_almacen) = n_alm.id_zona_almacen
LEFT JOIN caja_productos cp ON c.id_caja = cp.id_caja
GROUP BY 
  c.id_caja, 
  n.nombre, 
  s.nombre, 
  n_sec.nombre, 
  p.nombre, 
  n_pas.nombre, 
  a.nombre, 
  n_alm.nombre,
  c.id_zona_seccion,
  n.id_zona_seccion,
  s.id_zona_pasillo,
  n_sec.id_zona_pasillo,
  s.id_zona_almacen,
  n_sec.id_zona_almacen,
  p.id_zona_almacen,
  n_pas.id_zona_almacen;
