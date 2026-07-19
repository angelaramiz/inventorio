import { useState, useRef, useCallback } from "react";
import { Upload, X, Play, Check, AlertCircle, Loader2, Save, Pencil, Trash2, Package, ImagePlus } from "lucide-react";
import { toast } from "sonner";

interface OcrItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "success" | "error";
  result?: OcrResult;
  error?: string;
}

interface OcrResult {
  marca: string | null;
  talla: string | null;
  sku: string | null;
  modelo_grupo: string | null;
  codigo_color: string | null;
  fecha_temporada: string | null;
  tipo_producto?: string | null;
}

export default function BatchOcrView() {
  const [items, setItems] = useState<OcrItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<OcrResult>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const serverUrl = localStorage.getItem("serverUrl") || "";

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const base = serverUrl || window.location.origin;
    const res = await fetch(`${base}${path}`, {
      headers: { ...init?.headers },
      ...init,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Error ${res.status}`);
    }
    return res.json();
  }, [serverUrl]);

  const addImages = (files: FileList) => {
    const newItems: OcrItem[] = Array.from(files)
      .filter(f => f.type.startsWith("image/"))
      .map(f => ({
        id: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        status: "pending" as const,
      }));
    setItems(prev => [...prev, ...newItems]);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const startProcessing = async () => {
    const pending = items.filter(i => i.status === "pending");
    if (pending.length === 0) return;

    setIsProcessing(true);
    setItems(prev => prev.map(i =>
      i.status === "pending" ? { ...i, status: "processing" } : i
    ));

    for (const item of pending) {
      setItems(prev => prev.map(i =>
        i.id === item.id ? { ...i, status: "processing" } : i
      ));

      try {
        const formData = new FormData();
        formData.append("foto", item.file, item.file.name || "label.jpg");

        const result = await api("/api/ocr/extract-label", {
          method: "POST",
          body: formData,
        });

        setItems(prev => prev.map(i =>
          i.id === item.id
            ? { ...i, status: "success", result }
            : i
        ));
      } catch (e: any) {
        setItems(prev => prev.map(i =>
          i.id === item.id
            ? { ...i, status: "error", error: e.message }
            : i
        ));
      }
    }

    setIsProcessing(false);
    toast.success("Procesamiento completado");
  };

  const startEditing = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item?.result) {
      setEditingId(id);
      setEditForm({ ...item.result });
    }
  };

  const saveEdit = () => {
    if (!editingId) return;
    setItems(prev => prev.map(i =>
      i.id === editingId
        ? { ...i, result: { ...i.result!, ...editForm } }
        : i
    ));
    setEditingId(null);
  };

  const bulkSave = async () => {
    const successItems = items.filter(i => i.status === "success" && i.result);
    if (successItems.length === 0) return;

    try {
      await api("/api/productos/bulk-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productos: successItems.map(i => ({
            modelo_grupo: i.result!.modelo_grupo,
            codigo_color: i.result!.codigo_color,
            fecha_temporada: i.result!.fecha_temporada,
            sku: i.result!.sku,
            marca: i.result!.marca,
            talla: i.result!.talla,
            tipo_producto: i.result!.tipo_producto,
          }))
        }),
      });
      toast.success(`${successItems.length} productos guardados`);
      setItems([]);
    } catch (e: any) {
      toast.error(`Error al guardar: ${e.message}`);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending": return <div className="w-5 h-5 rounded-full border-2 border-neutral-300" />;
      case "processing": return <Loader2 size={20} className="animate-spin text-purple-500" />;
      case "success": return <Check size={20} className="text-emerald-500" />;
      case "error": return <AlertCircle size={20} className="text-red-500" />;
      default: return null;
    }
  };

  const stats = {
    total: items.length,
    pending: items.filter(i => i.status === "pending").length,
    success: items.filter(i => i.status === "success").length,
    error: items.filter(i => i.status === "error").length,
  };

  return (
    <div className="max-w-7xl mx-auto px-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between py-6">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-3">
            <Package size={28} className="text-purple-600" />
            Escaneo por Lote
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Procesa múltiples etiquetas usando IA (Groq + Gemini fallback)
          </p>
        </div>
        <div className="flex gap-2">
          {stats.success > 0 && (
            <button
              onClick={bulkSave}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
            >
              <Save size={16} /> Guardar {stats.success}
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-sm font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50"
          >
            <Upload size={16} /> Agregar
          </button>
          {stats.pending > 0 && (
            <button
              onClick={startProcessing}
              disabled={isProcessing}
              className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              Procesar {stats.pending}
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => e.target.files && addImages(e.target.files)}
      />

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="flex gap-3 mb-4">
          <StatBadge label="Total" count={stats.total} color="neutral" />
          <StatBadge label="Pendiente" count={stats.pending} color="amber" />
          <StatBadge label="Exitoso" count={stats.success} color="emerald" />
          <StatBadge label="Error" count={stats.error} color="red" />
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div
          className="border-2 border-dashed border-neutral-300 rounded-2xl p-16 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            e.dataTransfer.files && addImages(e.dataTransfer.files);
          }}
        >
          <ImagePlus size={48} className="mx-auto text-neutral-400 mb-4" />
          <p className="text-lg font-bold text-neutral-700">Arrastra imágenes aquí</p>
          <p className="text-sm text-neutral-500 mt-1">o haz clic para seleccionar múltiples fotos de etiquetas</p>
        </div>
      )}

      {/* Results grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {items.map(item => (
          <div
            key={item.id}
            className={`relative bg-white rounded-xl border-2 overflow-hidden transition-all ${
              item.status === "success" ? "border-emerald-200" :
              item.status === "error" ? "border-red-200" :
              "border-neutral-200"
            }`}
          >
            {/* Status badge */}
            <div className="absolute top-2 right-2 z-10">
              {statusIcon(item.status)}
            </div>

            {/* Image */}
            <div className="aspect-[3/4] bg-neutral-100 flex items-center justify-center overflow-hidden">
              <img src={item.preview} alt="Label" className="w-full h-full object-cover" />
            </div>

            {/* Result or placeholder */}
            <div className="p-3">
              {item.status === "processing" && (
                <p className="text-sm text-purple-600 animate-pulse">Analizando...</p>
              )}
              {item.status === "error" && (
                <div>
                  <p className="text-sm text-red-600 font-bold">Error</p>
                  <p className="text-xs text-red-500 truncate">{item.error}</p>
                </div>
              )}
              {item.status === "success" && item.result && (
                editingId === item.id ? (
                  <div className="space-y-2">
                    <EditInput label="Modelo" value={editForm.modelo_grupo || ""} onChange={v => setEditForm(f => ({ ...f, modelo_grupo: v }))} />
                    <EditInput label="Color" value={editForm.codigo_color || ""} onChange={v => setEditForm(f => ({ ...f, codigo_color: v }))} />
                    <EditInput label="SKU" value={editForm.sku || ""} onChange={v => setEditForm(f => ({ ...f, sku: v }))} />
                    <EditInput label="Talla" value={editForm.talla || ""} onChange={v => setEditForm(f => ({ ...f, talla: v }))} />
                    <EditInput label="Marca" value={editForm.marca || ""} onChange={v => setEditForm(f => ({ ...f, marca: v }))} />
                    <div className="flex gap-2 pt-1">
                      <button onClick={saveEdit} className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold">Guardar</button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-neutral-300 rounded-lg text-xs">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black text-neutral-900 truncate max-w-[70%]">
                        {item.result.modelo_grupo || "Sin modelo"}
                      </span>
                      <button onClick={() => startEditing(item.id)} className="text-neutral-400 hover:text-purple-600">
                        <Pencil size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                      {item.result.codigo_color && <Field label="Color" value={item.result.codigo_color} />}
                      {item.result.talla && <Field label="Talla" value={item.result.talla} />}
                      {item.result.sku && <Field label="SKU" value={item.result.sku} />}
                      {item.result.marca && <Field label="Marca" value={item.result.marca} />}
                    </div>
                  </div>
                )
              )}
            </div>

            <button
              onClick={() => removeItem(item.id)}
              className="absolute top-2 left-2 z-10 p-1 bg-white/80 rounded-full hover:bg-red-100 text-neutral-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const colors: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700",
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${colors[color] || colors.neutral}`}>
      {label} <span className="opacity-60">{count}</span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1 items-baseline">
      <span className="text-neutral-400">{label}:</span>
      <span className="text-neutral-700 font-medium">{value}</span>
    </div>
  );
}

function EditInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-neutral-500 w-12">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 px-2 py-1 text-xs border border-neutral-200 rounded-md focus:outline-none focus:border-purple-400"
      />
    </div>
  );
}
