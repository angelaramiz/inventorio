import { useState, useEffect, useMemo } from "react";
import { Search, ArrowRightLeft, Check, Loader2, Boxes, Barcode, Hash, X } from "lucide-react";
import { toast } from "sonner";

interface Producto {
  id: number;
  sku: string;
  ean_13?: string;
  talla?: string;
  temporada?: string;
  tipo?: string;
  marca_sub?: string;
  modelo_grupo?: string;
  codigo_color?: string;
  cantidad?: number;
  caja_id?: number;
}

interface Caja {
  id: number;
  sku: string;
  nombre: string;
  seccion?: string;
}

export default function TransferFormatView() {
  const [products, setProducts] = useState<Producto[]>([]);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [sourceCaja, setSourceCaja] = useState<number | null>(null);
  const [targetCaja, setTargetCaja] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [sortField, setSortField] = useState<string>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const serverUrl = localStorage.getItem("serverUrl") || "";

  const api = async (path: string, init?: RequestInit) => {
    const base = serverUrl || window.location.origin;
    const res = await fetch(`${base}${path}`, { headers: { ...init?.headers }, ...init });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  useEffect(() => {
    loadCajas();
    loadProducts();
  }, []);

  const loadCajas = async () => {
    try {
      const data = await api("/api/cajas");
      setCajas(data);
    } catch {}
  };

  const loadProducts = async () => {
    setLoading(true);
    try {
      const data = await api("/api/productos?limit=500");
      setProducts(data);
    } catch { toast.error("Error cargando productos"); }
    setLoading(false);
  };

  const loadProductsByCaja = async (cajaId: number) => {
    setLoading(true);
    try {
      const data = await api(`/api/cajas/${cajaId}/productos`);
      setProducts(data);
    } catch { toast.error("Error cargando productos"); }
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let list = [...products];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (p.sku || "").toLowerCase().includes(q) ||
        (p.modelo_grupo || "").toLowerCase().includes(q) ||
        (p.codigo_color || "").toLowerCase().includes(q) ||
        (p.talla || "").toLowerCase().includes(q) ||
        (p.marca_sub || "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? "";
      const bVal = (b as any)[sortField] ?? "";
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [products, search, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = filtered.map(p => p.id);
    setSelected(new Set(ids));
  };

  const clearSelection = () => setSelected(new Set());

  const executeTransfer = async () => {
    if (!sourceCaja || !targetCaja) return toast.error("Selecciona origen y destino");
    if (sourceCaja === targetCaja) return toast.error("Origen y destino no pueden ser iguales");
    if (selected.size === 0) return toast.error("Selecciona productos a transferir");

    setTransferring(true);
    try {
      const items = Array.from(selected).map(id => ({
        id_producto: id,
        cantidad: quantities[id] || 1,
      }));

      await api("/api/transferir-producto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caja_origen_id: sourceCaja,
          caja_destino_id: targetCaja,
          items,
        }),
      });

      toast.success(`${selected.size} productos transferidos`);
      setSelected(new Set());
      setQuantities({});
      loadProductsByCaja(sourceCaja);
    } catch (e: any) {
      toast.error(`Error: ${e.message}`);
    }
    setTransferring(false);
  };

  const totalItems = filtered.length;
  const selectedCount = selected.size;

  return (
    <div className="max-w-full mx-auto px-4 pb-20">
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
            <ArrowRightLeft size={28} className="text-orange-600" />
            Transferencia de Productos
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Mueve productos entre cajas — selecciona origen, destino y los items
          </p>
        </div>
      </div>

      {/* Source / Target selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 p-4 bg-orange-50 rounded-2xl border border-orange-200">
        <div>
          <label className="text-xs font-bold text-orange-800 uppercase mb-1 block">Caja Origen</label>
          <select
            value={sourceCaja ?? ""}
            onChange={e => {
              const id = Number(e.target.value);
              setSourceCaja(id);
              setSelected(new Set());
              loadProductsByCaja(id);
            }}
            className="w-full px-3 py-2.5 bg-white border border-orange-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-500"
          >
            <option value="">Seleccionar origen...</option>
            {cajas.map(c => (
              <option key={c.id} value={c.id}>{c.sku} — {c.nombre}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-orange-800 uppercase mb-1 block">Caja Destino</label>
          <select
            value={targetCaja ?? ""}
            onChange={e => setTargetCaja(Number(e.target.value))}
            className="w-full px-3 py-2.5 bg-white border border-orange-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-500"
          >
            <option value="">Seleccionar destino...</option>
            {cajas.filter(c => c.id !== sourceCaja).map(c => (
              <option key={c.id} value={c.id}>{c.sku} — {c.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por SKU, modelo, color..."
            className="w-full pl-9 pr-3 py-2 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
          />
        </div>
        <button onClick={selectAll} className="px-3 py-2 text-xs font-bold bg-neutral-100 rounded-lg hover:bg-neutral-200">
          Todos
        </button>
        <button onClick={clearSelection} className="px-3 py-2 text-xs font-bold bg-neutral-100 rounded-lg hover:bg-neutral-200">
          Ninguno
        </button>
        <span className="text-xs text-neutral-500">
          {totalItems} items • {selectedCount} seleccionados
        </span>
        {selectedCount > 0 && sourceCaja && targetCaja && (
          <button
            onClick={executeTransfer}
            disabled={transferring}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700 disabled:opacity-50 ml-auto"
          >
            {transferring ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}
            Transferir {selectedCount}
          </button>
        )}
      </div>

      {/* Excel-like table */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-neutral-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-neutral-400">
            <Boxes size={48} className="mx-auto mb-3" />
            <p className="font-bold">Sin productos</p>
            <p className="text-sm">Selecciona una caja origen para ver sus productos</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-neutral-50 border-b border-neutral-200 z-10">
                <tr>
                  <th className="px-3 py-2.5 text-left w-10">
                    <input
                      type="checkbox"
                      checked={selectedCount === totalItems && totalItems > 0}
                      onChange={() => selectedCount === totalItems ? clearSelection() : selectAll()}
                      className="rounded"
                    />
                  </th>
                  <SortableTh field="id" label="#" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="sku" label="SKU" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="modelo_grupo" label="Modelo" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="codigo_color" label="Color" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="talla" label="Talla" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="marca_sub" label="Marca" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh field="temporada" label="Temp." sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                  <th className="px-3 py-2.5 text-left font-black text-neutral-500 text-[10px] uppercase">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-100 transition-colors ${
                      selected.has(p.id) ? "bg-orange-50" : idx % 2 === 0 ? "bg-white" : "bg-neutral-50/50"
                    } hover:bg-purple-50/30`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2 text-neutral-400 text-xs">{p.id}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-purple-700">{p.sku || "-"}</td>
                    <td className="px-3 py-2 font-bold text-neutral-800">{p.modelo_grupo || "-"}</td>
                    <td className="px-3 py-2">{p.codigo_color || "-"}</td>
                    <td className="px-3 py-2">{p.talla || "-"}</td>
                    <td className="px-3 py-2 text-xs">{p.marca_sub || "-"}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{p.temporada || "-"}</td>
                    <td className="px-3 py-2">
                      {selected.has(p.id) ? (
                        <input
                          type="number"
                          min={1}
                          value={quantities[p.id] || 1}
                          onChange={e => setQuantities(q => ({ ...q, [p.id]: Number(e.target.value) || 1 }))}
                          className="w-16 px-2 py-1 border border-orange-200 rounded text-xs text-center font-bold focus:outline-none focus:border-orange-500"
                        />
                      ) : (
                        <span className="text-neutral-400">{p.cantidad || 0}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SortableTh({ field, label, sortField, sortDir, onClick }: {
  field: string; label: string; sortField: string; sortDir: string;
  onClick: (field: string) => void;
}) {
  const isActive = sortField === field;
  return (
    <th
      className="px-3 py-2.5 text-left font-black text-neutral-500 text-[10px] uppercase cursor-pointer hover:text-neutral-900 select-none whitespace-nowrap"
      onClick={() => onClick(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        {isActive && <span className="text-[8px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
