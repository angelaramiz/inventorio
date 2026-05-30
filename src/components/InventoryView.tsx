import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Package, Image as ImageIcon, Loader2, Calendar, Edit2, Trash2, SlidersHorizontal, X } from "lucide-react";
import { Producto } from "../types";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import ProductEditModal from "./ProductEditModal";
import ProductQuickRegister from "./ProductQuickRegister";
import ProductGroupEditModal from "./ProductGroupEditModal";

const TALLAS_LETRA = ["SinTalla", "XS", "S", "M", "L", "XL", "XXL"];
const TALLAS_NUMERO = ["SinTalla", "38", "40", "42", "44", "46", "48"];

export default function InventoryView() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMarca, setFilterMarca] = useState("");
  const [filterTalla, setFilterTalla] = useState("");
  const [filterTemporada, setFilterTemporada] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showQuickRegister, setShowQuickRegister] = useState(false);
  const [showGroupEditModal, setShowGroupEditModal] = useState(false);
  const [temporadasOpts, setTemporadasOpts] = useState<string[]>([]);
  const [marcasOpts, setMarcasOpts] = useState<string[]>([]);
  const [tiposOpts, setTiposOpts] = useState<string[]>([]);

  useEffect(() => {
    fetchProductos();
    fetchFilterOptions();
  }, []);

  const fetchProductos = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/productos");
      if (resp.ok) {
        const data = await resp.json();
        setProductos(Array.isArray(data) ? data : []);
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al cargar productos");
        setProductos([]);
      }
    } catch (err) {
      toast.error("Error al cargar productos");
      setProductos([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const [respTemp, respMarcas, respTipos] = await Promise.all([
        fetch("/api/conceptos/temporadas"),
        fetch("/api/conceptos/marcas"),
        fetch("/api/conceptos/tipos"),
      ]);
      const tempVals = await respTemp.json();
      const marcaVals = await respMarcas.json();
      const tipoVals = await respTipos.json();
      setTemporadasOpts(tempVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
      setMarcasOpts(marcaVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
      setTiposOpts(tipoVals.map((v: any) => typeof v === 'object' ? v.nombre : v));
    } catch (err) {
      console.error("Error loading filter options", err);
    }
  };

  const handleDeleteProduct = async (product: Producto) => {
    if (!window.confirm(`¿Estás seguro de eliminar el producto "${product.sku}"? Se eliminará permanentemente de todas las cajas asignadas.`)) {
      return;
    }

    try {
      const resp = await fetch(`/api/productos/${product.id_producto}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        toast.success("Producto eliminado con éxito");
        fetchProductos();
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al eliminar producto");
      }
    } catch (err) {
      toast.error("Error de conexión");
    }
  };

  const activeFilterCount = [filterMarca, filterTalla, filterTemporada, filterTipo].filter(Boolean).length;

  const filtered = productos.filter(p => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = !term || 
      p.sku.toLowerCase().includes(term) ||
      p.ean_13.toLowerCase().includes(term) ||
      p.marca_sub.toLowerCase().includes(term);
    const matchesMarca = !filterMarca || p.marca_sub.toLowerCase() === filterMarca.toLowerCase();
    const matchesTalla = !filterTalla || p.talla.toLowerCase() === filterTalla.toLowerCase();
    const matchesTemporada = !filterTemporada || p.temporada.toLowerCase() === filterTemporada.toLowerCase();
    const matchesTipo = !filterTipo || (p.tipo && p.tipo.toLowerCase() === filterTipo.toLowerCase());
    return matchesSearch && matchesMarca && matchesTalla && matchesTemporada && matchesTipo;
  });

  const clearFilters = () => {
    setFilterMarca("");
    setFilterTalla("");
    setFilterTemporada("");
    setFilterTipo("");
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-black tracking-tight flex items-center gap-3 text-neutral-900 uppercase">
            <Package size={32} className="text-neutral-400" /> Stock Global
          </h2>
          <p className="text-sm text-neutral-500 font-medium">Catálogo dinámico de artículos</p>
        </div>

        <div className="flex gap-2 items-center w-full md:w-auto">
          <Button
            onClick={() => setShowQuickRegister(true)}
            className="rounded-xl h-12 bg-neutral-900 hover:bg-neutral-800 text-white font-extrabold text-xs uppercase tracking-wider px-5 shrink-0 flex items-center gap-1.5 shadow-md"
          >
            <Package size={16} />
            Crear Grupo
          </Button>
          <Button
            onClick={() => setShowGroupEditModal(true)}
            className="rounded-xl h-12 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-extrabold text-xs uppercase tracking-wider px-5 shrink-0 flex items-center gap-1.5 shadow-md"
          >
            <SlidersHorizontal size={16} />
            Editar Grupo
          </Button>
          <div className="flex gap-3 bg-white p-1.5 rounded-2xl shadow-sm border border-neutral-100 flex-1 md:w-96 overflow-hidden focus-within:border-neutral-900 transition-colors">
            <div className="flex items-center pl-3 text-neutral-400">
              <Search size={20} />
            </div>
            <Input 
              placeholder="SKU, EAN o Marca..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="border-none bg-transparent focus-visible:ring-0 text-base h-11"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="pr-3 text-neutral-400 hover:text-neutral-700">
                <X size={16} />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className={`relative rounded-xl h-12 px-4 border transition-all ${showFilters ? "bg-neutral-900 text-white border-neutral-900" : "bg-white"}`}
          >
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-amber-400 text-neutral-950 text-[10px] font-black rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-white border border-neutral-100 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Marca</label>
                <select
                  value={filterMarca}
                  onChange={e => setFilterMarca(e.target.value)}
                  className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-sm font-semibold outline-none h-10 focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="">Todas las marcas</option>
                  {marcasOpts.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Talla (Letra)</label>
                <select
                  value={filterTalla}
                  onChange={e => setFilterTalla(e.target.value)}
                  className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-sm font-semibold outline-none h-10 focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="">Todas las tallas</option>
                  {[...TALLAS_LETRA, ...TALLAS_NUMERO.filter(t => t !== "SinTalla")].filter((v, i, arr) => arr.indexOf(v) === i).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Temporada</label>
                <select
                  value={filterTemporada}
                  onChange={e => setFilterTemporada(e.target.value)}
                  className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-sm font-semibold outline-none h-10 focus:ring-1 focus:ring-neutral-900"
                >
                  <option value="">Todas las temporadas</option>
                  {temporadasOpts.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-[10px] uppercase font-black tracking-wider text-neutral-400">Tipo</label>
                <select
                  value={filterTipo}
                  onChange={e => setFilterTipo(e.target.value)}
                  className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-sm font-semibold outline-none h-10 focus:ring-1 focus:ring-neutral-900 uppercase"
                >
                  <option value="">Todos los tipos</option>
                  {tiposOpts.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                </select>
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" onClick={clearFilters} className="h-10 rounded-xl text-xs font-bold text-neutral-500 hover:text-red-500 hover:bg-red-50 gap-1.5">
                  <X size={14} /> Limpiar filtros
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  className="relative bg-white p-4 rounded-3xl border border-neutral-100 shadow-sm flex flex-col sm:flex-row gap-4 hover:border-neutral-900 transition-all group overflow-hidden"
                >
                  <div className="absolute top-3 right-3 flex gap-1 items-center md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => {
                        setSelectedProduct(p);
                        setShowEditModal(true);
                      }}
                      className="h-8 w-8 rounded-lg bg-neutral-50 hover:bg-neutral-900 hover:text-white border"
                    >
                      <Edit2 size={13} />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => handleDeleteProduct(p)}
                      className="h-8 w-8 rounded-lg bg-neutral-50 hover:bg-rose-500 hover:text-white text-rose-500 border"
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      {p.has_foto ? (
                        <img 
                          src={`/api/productos/${p.id_producto}/image`}
                          alt={p.sku} 
                          loading="lazy"
                          className="w-20 h-20 sm:w-20 sm:h-20 object-cover rounded-2xl shadow-md border-2 border-white group-hover:scale-105 transition-transform" 
                        />
                      ) : (
                        <div className="w-20 h-20 sm:w-20 sm:h-20 bg-neutral-100 rounded-2xl flex items-center justify-center text-neutral-300 border">
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

      {selectedProduct && showEditModal && (
        <ProductEditModal 
          product={selectedProduct}
          onClose={() => {
            setSelectedProduct(null);
            setShowEditModal(false);
          }}
          onSuccess={fetchProductos}
        />
      )}

      {showQuickRegister && (
        <ProductQuickRegister
          ean=""
          initialIsGroup={true}
          onClose={() => setShowQuickRegister(false)}
          onSuccess={() => {
            setShowQuickRegister(false);
            fetchProductos();
          }}
          onSuccessGroup={() => {
            setShowQuickRegister(false);
            fetchProductos();
          }}
        />
      )}

      {showGroupEditModal && (
        <ProductGroupEditModal
          uniqueModels={Array.from(
            new Set(
              productos
                .map((p: any) => p.modelo_grupo)
                .filter((m): m is string => typeof m === "string" && m !== "" && m !== "sin modelo")
            )
          )}
          onClose={() => setShowGroupEditModal(false)}
          onSuccess={fetchProductos}
        />
      )}
    </div>
  );
}
