import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Box, Package, Image as ImageIcon, Loader2 } from "lucide-react";
import { Caja, CajaProducto } from "../types";

interface Props {
  caja: Caja;
  onClose: () => void;
}

export default function CajaDetailsModal({ caja, onClose }: Props) {
  const [productos, setProductos] = useState<CajaProducto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProductos();
  }, [caja.id_caja]);

  const fetchProductos = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/cajas/${caja.id_caja}/productos`);
      const data = await resp.json();
      setProductos(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl h-[80vh] flex flex-col p-0 border-none rounded-2xl overflow-hidden shadow-2xl">
        <DialogHeader className="bg-neutral-900 text-white p-6 shrink-0">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="bg-white/10 p-3 rounded-xl">
                <Box size={32} />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black tracking-tight">CAJA {caja.numero_caja}</DialogTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 border-none uppercase text-[10px]">{caja.estado}</Badge>
                  <span className="text-neutral-400 text-xs">{caja.total_unidades} unidades totales</span>
                </div>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-6 bg-white">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-400">
              <Loader2 className="animate-spin mb-2" size={32} />
              <p className="font-medium">Cargando inventario de caja...</p>
            </div>
          ) : productos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-neutral-400 border-2 border-dashed rounded-3xl">
              <Package size={48} strokeWidth={1} className="mb-4 opacity-20" />
              <p className="font-semibold">Esta caja está vacía</p>
              <p className="text-sm">Escanea productos para empezar a llenarla</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader className="bg-neutral-50/50">
                  <TableRow>
                    <TableHead className="w-[80px]">Foto</TableHead>
                    <TableHead>Producto (SKU)</TableHead>
                    <TableHead>Detalles</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productos.map((item) => (
                    <TableRow key={item.id_producto} className="group hover:bg-neutral-50/50">
                      <TableCell>
                        <img 
                          src={`/api/productos/${item.id_producto}/image`}
                          alt="Producto" 
                          loading="lazy"
                          className="w-12 h-12 object-cover rounded-lg shadow-sm border" 
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            // Show parent's background or similar if really needed, 
                            // but simple hide works for minimal UI
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-bold text-neutral-900">{item.productos.sku}</span>
                          <span className="text-xs text-neutral-500 font-mono">{item.productos.ean_13}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5 flex-wrap">
                          <Badge variant="secondary" className="text-[10px] uppercase font-bold">{item.productos.tipo}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">{item.productos.talla}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase font-bold bg-white">{item.productos.temporada}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-black text-lg">
                        <span className="bg-neutral-100 px-3 py-1 rounded-lg border">{item.cantidad}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
