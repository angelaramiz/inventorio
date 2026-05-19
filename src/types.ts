export type Temporada = 'verano' | 'invierno' | 'entretiempo' | 'todouso';
export type TipoProducto = 'pantalon' | 'accesorio' | 'camisa' | 'calzado' | 'chaqueta' | 'otro';
export type EstadoCaja = 'vacia' | 'activa' | 'llena';

export interface Producto {
  id_producto: number;
  sku: string;
  ean_13: string;
  talla: string;
  temporada: Temporada;
  tipo: TipoProducto;
  marca_sub: string;
  foto?: string;
  activo: boolean;
  created_at: string;
}

export interface Caja {
  id_caja: number;
  numero_caja: string;
  sku?: string;
  estado: EstadoCaja;
  fecha_creacion: string;
  total_productos_unicos?: number;
  total_unidades?: number;
}

export interface CajaProducto {
  id_producto: number;
  cantidad: number;
  productos: Producto;
}
