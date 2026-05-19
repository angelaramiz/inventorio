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
