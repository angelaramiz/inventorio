import { useState, useRef, useCallback } from "react";
import { Upload, X, Play, Check, AlertCircle, Loader2, Save, Pencil, Trash2, Package, ImagePlus, RefreshCw, Camera, Hash, Scan } from "lucide-react";
import { toast } from "sonner";

interface OcrItem {
  id: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "success" | "error";
  barcode?: string;
  result?: OcrResult;
  error?: string;
  retryCount: number;
  cantidad: number;
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

interface GroupPhoto {
  modelo: string;
  uri: string;
}

export default function BatchOcrView() {
  const [items, setItems] = useState<OcrItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<OcrResult> & { cantidad?: number }>({});
  const [rpmLimit, setRpmLimit] = useState(5);
  const [groupPhotos, setGroupPhotos] = useState<GroupPhoto[]>([]);
  const [showGroupPhotos, setShowGroupPhotos] = useState(false);
  const [groupPhotoTarget, setGroupPhotoTarget] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupPhotoInputRef = useRef<HTMLInputElement>(null);
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

  const updateItem = (id: string, patch: Partial<OcrItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const addImages = (files: FileList) => {
    const newItems: OcrItem[] = Array.from(files)
      .filter(f => f.type.startsWith("image/"))
      .map(f => ({
        id: crypto.randomUUID(),
        file: f,
        preview: URL.createObjectURL(f),
        status: "pending" as const,
        retryCount: 0,
        cantidad: 1,
      }));
    setItems(prev => [...prev, ...newItems]);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  // Dedup + auto-increment: find success items by barcode and increment quantity instead of re-processing
  const findResolvedSibling = (barcode: string): OcrItem | undefined => {
    return items.find(i => i.barcode === barcode && i.status === "success");
  };

  const processSingleItem = async (item: OcrItem, signal: AbortSignal): Promise<Partial<OcrItem>> => {
    try {
      const formData = new FormData();
      formData.append("foto", item.file, item.file.name || "label.jpg");

      const result = await api("/api/ocr/extract-label", {
        method: "POST",
        body: formData,
        signal,
      });

      const extractedBarcode = result.sku || "";
      return { status: "success", result, barcode: extractedBarcode, cantidad: 1 };
    } catch (e: any) {
      if (e.name === "AbortError") throw e;
      return { status: item.retryCount < 2 ? "pending" as const : "error" as const, error: e.message, retryCount: item.retryCount + 1 };
    }
  };

  const startProcessing = async () => {
    const pending = items.filter(i => i.status === "pending");
    if (pending.length === 0) return;

    setIsProcessing(true);
    setGroupPhotos([]);
    const delayMs = Math.round(60_000 / Math.max(1, Math.min(15, rpmLimit)));

    // Mark all pending as processing
    setItems(prev => prev.map(i =>
      i.status === "pending" ? { ...i, status: "processing" } : i
    ));

    for (const item of pending) {
      // Pre-check: dedup via barcode - if the barcode matches an existing success item, auto-increment quantity
      if (item.barcode) {
        const sibling = findResolvedSibling(item.barcode);
        if (sibling && sibling.result) {
          // Instead of creating a new item, increment the existing sibling's quantity
          setItems(prev => prev.map(i =>
            i.id === sibling.id ? { ...i, cantidad: i.cantidad + 1 } : i
          ));
          // Remove this duplicate pending item
          removeItem(item.id);
          continue;
        }
      }

      const startTime = Date.now();

      // Retry loop up to 3 attempts
      let currentItem = { ...item, status: "processing" as const };
      for (let attempt = 0; attempt < 3; attempt++) {
        updateItem(currentItem.id, { status: "processing", retryCount: attempt });

        const result = await processSingleItem(currentItem, new AbortController().signal);

        if (result.status === "success") {
          // After processing, check if this barcode matches another success item (auto-increment)
          const resultBarcode = result.barcode || result.result?.sku || "";
          if (resultBarcode) {
            const existing = items.filter(i =>
              i.id !== currentItem.id &&
              i.barcode === resultBarcode &&
              i.status === "success"
            );
            if (existing.length > 0) {
              // Auto-increment the existing item's cantidad and remove this duplicate
              setItems(prev => prev.map(i =>
                i.id === existing[0].id ? { ...i, cantidad: i.cantidad + 1 } : i
              ));
              removeItem(currentItem.id);
              break;
            }
          }

          updateItem(currentItem.id, {
            status: "success",
            result: result.result,
            barcode: resultBarcode,
            error: undefined,
          });
          break;
        }

        if (result.status !== "pending") {
          updateItem(currentItem.id, { status: "error", error: result.error, retryCount: attempt + 1 });
          break;
        }

        // Exponential backoff
        const backoff = 2000 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, backoff));
        currentItem = { ...currentItem, retryCount: attempt + 1 };
      }

      // RPM throttle
      const elapsed = Date.now() - startTime;
      const remaining = delayMs - elapsed;
      if (remaining > 0) {
        await new Promise(r => setTimeout(r, remaining));
      }
    }

    setIsProcessing(false);
    toast.success("Procesamiento completado");

    // Setup group photos
    const successItems = items.filter(i => i.status === "success" || i.status === "pending");
    // Wait a tick for state to settle, then set group photos
    setTimeout(() => {
      setItems(current => {
        const models = new Map<string, GroupPhoto>();
        current.filter(i => i.status === "success" && i.result?.modelo_grupo).forEach(i => {
          const m = i.result!.modelo_grupo!;
          if (!models.has(m)) {
            models.set(m, { modelo: m, uri: "" });
          }
        });
        setGroupPhotos(Array.from(models.values()));
        if (models.size > 0) setShowGroupPhotos(true);
        return current;
      });
    }, 100);
  };

  const triggerGroupPhoto = (modelo: string) => {
    setGroupPhotoTarget(modelo);
    setTimeout(() => {
      if (groupPhotoInputRef.current) {
        groupPhotoInputRef.current.value = "";
        groupPhotoInputRef.current.click();
      }
    }, 50);
  };

  const retryItem = (id: string) => {
    updateItem(id, { status: "pending", error: undefined, retryCount: 0, cantidad: 1 });
  };

  const startEditing = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item?.result) {
      setEditingId(id);
      setEditForm({ ...item.result, cantidad: item.cantidad });
    }
  };

  const saveEdit = () => {
    if (!editingId) return;
    setItems(prev => prev.map(i =>
      i.id === editingId
        ? { ...i, result: { ...i.result!, ...editForm }, cantidad: editForm.cantidad ?? i.cantidad }
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
          productos: successItems.flatMap(i =>
            Array.from({ length: i.cantidad }, () => ({
              modelo_grupo: i.result!.modelo_grupo,
              codigo_color: i.result!.codigo_color,
              fecha_temporada: i.result!.fecha_temporada,
              sku: i.result!.sku,
              marca: i.result!.marca,
              talla: i.result!.talla,
              tipo_producto: i.result!.tipo_producto,
            }))
          ),
        }),
      });
      const totalCount = successItems.reduce((s, i) => s + i.cantidad, 0);
      toast.success(`${totalCount} productos guardados (${successItems.length} registros)`);
      setItems([]);
      setGroupPhotos([]);
      setShowGroupPhotos(false);
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
    processing: items.filter(i => i.status === "processing").length,
    success: items.filter(i => i.status === "success").length,
    error: items.filter(i => i.status === "error").length,
  };
  const totalQuantity = items.filter(i => i.status === "success").reduce((s, i) => s + i.cantidad, 0);

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
          <span
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-neutral-900 text-white rounded-xl text-sm font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Upload size={16} /> Agregar
          </span>
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
          {stats.success > 0 && (
            <button
              onClick={bulkSave}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors"
            >
              <Save size={16} /> Guardar {totalQuantity}
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

      {/* Config bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4 p-4 bg-neutral-50 rounded-2xl border border-neutral-200">
        <div className="flex items-center gap-3">
          <label className="text-xs font-bold text-neutral-600 uppercase">RPM</label>
          <input
            type="range"
            min={1}
            max={15}
            value={rpmLimit}
            onChange={e => setRpmLimit(Number(e.target.value))}
            className="w-24"
            disabled={isProcessing}
          />
          <span className="text-sm font-bold text-purple-700 min-w-[2ch]">{rpmLimit}</span>
        </div>
        <div className="text-xs text-neutral-400">
          ~{rpmLimit} requests/min · ~{Math.round(60 / rpmLimit)}s entre imágenes
        </div>
      </div>

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="flex gap-3 mb-4">
          <StatBadge label="Total" count={stats.total} color="neutral" />
          <StatBadge label="Pend." count={stats.pending} color="amber" />
          <StatBadge label="Procesando" count={stats.processing} color="purple" />
          <StatBadge label="OK" count={stats.success} color="emerald" subtitle={totalQuantity > stats.success ? `${totalQuantity}uds` : undefined} />
          <StatBadge label="Error" count={stats.error} color="red" />
        </div>
      )}

      {/* Group Photos Section */}
      {showGroupPhotos && groupPhotos.length > 0 && (
        <div className="mb-6 p-4 bg-white rounded-2xl border border-neutral-200">
          <h2 className="text-sm font-black text-neutral-900 mb-3 flex items-center gap-2">
            <Camera size={16} className="text-purple-600" />
            Fotos Grupales por Modelo
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {groupPhotos.map(gp => (
              <div key={gp.modelo} className="flex flex-col items-center gap-2">
                <div
                  onClick={() => triggerGroupPhoto(gp.modelo)}
                  className="w-full aspect-square bg-neutral-100 rounded-xl border-2 border-dashed border-neutral-300 flex items-center justify-center cursor-pointer hover:border-purple-400 hover:bg-purple-50/50 overflow-hidden"
                >
                  {gp.uri ? (
                    <img src={gp.uri} alt={gp.modelo} className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center">
                      <ImagePlus size={24} className="mx-auto text-neutral-400" />
                      <p className="text-[10px] text-neutral-400 mt-1 font-medium">Foto</p>
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-bold text-neutral-700 text-center truncate w-full">{gp.modelo}</p>
              </div>
            ))}
            <input ref={groupPhotoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                const target = groupPhotoTarget;
                if (file && target) {
                  const uri = URL.createObjectURL(file);
                  setGroupPhotos(prev => prev.map(gp => gp.modelo === target ? { ...gp, uri } : gp));
                  setGroupPhotoTarget(null);
                }
              }} />
          </div>
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
              item.status === "processing" ? "border-purple-200" :
              "border-neutral-200"
            }`}
          >
            {/* Status badge */}
            <div className="absolute top-2 right-2 z-10">
              {statusIcon(item.status)}
            </div>

            {/* Cantidad badge */}
            {item.cantidad > 1 && item.status === "success" && (
              <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-purple-600 text-white rounded-full text-[10px] font-bold">
                x{item.cantidad}
              </div>
            )}

            {/* Image */}
            <div className="aspect-[3/4] bg-neutral-100 flex items-center justify-center overflow-hidden">
              <img src={item.preview} alt="Label" className="w-full h-full object-cover" />
            </div>

            {/* Result or placeholder */}
            <div className="p-3">
              {item.status === "processing" && (
                <p className="text-sm text-purple-600 animate-pulse">
                  {item.retryCount > 0 ? `Reintento ${item.retryCount}/3...` : "Analizando..."}
                </p>
              )}
              {item.status === "error" && (
                <div>
                  <p className="text-sm text-red-600 font-bold">Error</p>
                  <p className="text-xs text-red-500 truncate">{item.error}</p>
                  <button
                    onClick={() => retryItem(item.id)}
                    className="mt-2 flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-bold hover:bg-red-200"
                  >
                    <RefreshCw size={12} /> Reintentar
                  </button>
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
                    <div>
                      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-0.5">Cantidad</label>
                      <input type="number" min={1} value={editForm.cantidad ?? 1}
                        onChange={e => setEditForm(f => ({ ...f, cantidad: Math.max(1, parseInt(e.target.value) || 1) }))}
                        className="w-full px-2 py-1.5 border border-neutral-200 rounded-lg text-xs focus:outline-none focus:border-purple-400" />
                    </div>
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
                    {item.cantidad > 1 && (
                      <div className="mt-1.5 text-[10px] font-bold text-purple-600 flex items-center gap-1">
                        <Hash size={10} /> Cantidad: {item.cantidad}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>

            <button
              onClick={() => removeItem(item.id)}
              className="absolute bottom-2 left-2 z-10 p-1 bg-white/80 rounded-full hover:bg-red-100 text-neutral-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>

            {item.barcode && item.status === "success" && (
              <div className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 bg-purple-50 rounded text-[9px] text-purple-600 font-mono font-bold truncate max-w-[40%]">
                {item.barcode}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Subcomponents
// ═══════════════════════════════════════════════════════════════════

function StatBadge({ label, count, color, subtitle }: { label: string; count: number; color: string; subtitle?: string }) {
  const colors: Record<string, string> = {
    neutral: "bg-neutral-100 text-neutral-700",
    amber: "bg-amber-100 text-amber-700",
    purple: "bg-purple-100 text-purple-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };
  return (
    <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${colors[color] || colors.neutral}`}>
      {count} <span className="font-normal opacity-70">{label}</span>
      {subtitle && <span className="ml-1 text-[10px] opacity-80">({subtitle})</span>}
    </div>
  );
}

function EditInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-0.5">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 border border-neutral-200 rounded-lg text-xs focus:outline-none focus:border-purple-400"
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="text-neutral-500"><span className="font-bold text-neutral-700">{label}:</span> {value}</div>;
}
