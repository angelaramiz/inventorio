import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Package, Image as ImageIcon, Loader2, Calendar } from "lucide-react";
import { Producto } from "../types";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";

export default function InventoryView() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchProductos();
  }, []);

  const fetchProductos = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/productos");
      const data = await resp.json();
      setProductos(data);
    } catch (err) {
      toast.error("Error al cargar productos");
    } finally {
      setLoading(false);
    }
  };

  const filtered = productos.filter(p => 
    p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.ean_13.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.marca_sub.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-3 text-neutral-900 uppercase">
            <Package size={32} className="text-neutral-400" /> Stock Global
          </h2>
          <p className="text-sm text-neutral-500 font-medium">Catálogo dinámico de artículos</p>
        </div>

        <div className="flex gap-3 bg-white p-1.5 rounded-2xl shadow-sm border border-neutral-100 w-full md:w-96 overflow-hidden focus-within:border-neutral-900 transition-colors">
          <div className="flex items-center pl-3 text-neutral-400">
            <Search size={20} />
          </div>
          <Input 
            placeholder="SKU, EAN o Marca..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="border-none bg-transparent focus-visible:ring-0 text-base h-11"
          />
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-neutral-400">
            <Loader2 className="animate-spin mb-4" size={40} />
            <p className="font-semibold uppercase tracking-widest text-xs">Sincronizando base de datos...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-neutral-400 border-2 border-dashed border-neutral-100 rounded-[2rem]">
            <Search size={48} strokeWidth={1} className="mb-4 opacity-20" />
            <p className="font-bold text-neutral-900">SIN RESULTADOS</p>
            <p className="text-xs">Ajusta los filtros de búsqueda</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-1 gap-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((p) => (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={p.id_producto}
                  className="bg-white p-4 rounded-3xl border border-neutral-100 shadow-sm flex flex-col sm:flex-row gap-4 hover:border-neutral-900 transition-all group"
                >
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {p.id_producto ? (
                        <img 
                          src={`/api/productos/${p.id_producto}/image`}
                          alt={p.sku} 
                          loading="lazy"
                          className="w-20 h-20 sm:w-20 sm:h-20 object-cover rounded-2xl shadow-md border-2 border-white group-hover:scale-105 transition-transform" 
                          onError={(e) => {
                            // Fallback to placeholder if image fails to load
                            (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Img';
                          }}
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-20 sm:h-20 bg-neutral-100 rounded-2xl flex items-center justify-center text-neutral-300">
                          <ImageIcon size={32} strokeWidth={1} />
                        </div>
                      )}
                      <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm ${
                        p.temporada === 'verano' ? 'bg-amber-400' :
                        p.temporada === 'invierno' ? 'bg-blue-500' :
                        p.temporada === 'entretiempo' ? 'bg-emerald-500' : 'bg-neutral-500'
                      }`} title={p.temporada} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge className="bg-neutral-950 border-none uppercase text-[9px] font-black py-0.5 px-2">{p.tipo}</Badge>
                        <Badge variant="outline" className="border-neutral-200 text-neutral-500 uppercase text-[9px] font-black py-0.5 px-2">{p.talla}</Badge>
                      </div>
                      <h3 className="font-black text-xl text-neutral-900 leading-none truncate tracking-tighter uppercase">{p.sku}</h3>
                      <p className="text-[10px] text-neutral-400 font-mono mt-1 font-bold">{p.ean_13}</p>
                    </div>
                  </div>

                  <div className="sm:ml-auto flex items-end justify-between sm:flex-col sm:justify-between gap-2 pt-3 sm:pt-1 border-t sm:border-t-0 border-neutral-50">
                    <div className="text-left sm:text-right w-full">
                      <p className="text-[9px] uppercase font-black text-neutral-300 tracking-widest leading-none">Proveedor / Marca</p>
                      <p className="text-sm font-bold text-neutral-600 truncate">{p.marca_sub}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-neutral-400 bg-neutral-50 px-2 py-1 rounded-lg border border-neutral-100 self-end">
                      <Calendar size={12} />
                      <span className="text-[10px] font-bold text-neutral-500">
                        {new Date(p.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      
      <div className="flex justify-between items-center text-[10px] text-neutral-400 font-black uppercase tracking-[0.2em] px-4 py-2 bg-neutral-100 rounded-xl border border-neutral-100">
        <p>Total Items: <span className="text-neutral-900">{filtered.length}</span></p>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
          Live Cloud
        </div>
      </div>
    </div>
  );
}
