import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  Plus, Settings, Printer, Network, Folder, ChevronDown, ChevronRight, 
  Trash2, Edit2, Loader2, Save, RefreshCw, Barcode, Eye, FileText, ArrowRight
} from "lucide-react";
import { toast } from "sonner";
// @ts-ignore
import JsBarcode from "jsbarcode";

interface HierarchyNode {
  id: number;
  parent_id: number | null;
  tipo_almacen: string;
  sku_asociado: string | null;
  codigo_barras: string;
  stock_real: number;
  created_at: string;
  updated_at: string;
}

export default function HierarchyView() {
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<any>({
    prefijos: { caja: "CJ", estante: "EST", perchero: "PER", bodega: "BOD" },
    secuencias: { caja: 1, estante: 1, perchero: 1, bodega: 1 },
    tipos_contenedor: ["caja", "estante", "perchero", "bodega"]
  });
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  
  // Form states
  const [selectedParentId, setSelectedParentId] = useState<string>("null");
  const [newTipo, setNewTipo] = useState("caja");
  const [newSku, setNewSku] = useState("");
  const [newStock, setNewStock] = useState<number | "">(0);
  const [customBarcode, setCustomBarcode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [products, setProducts] = useState<any[]>([]);

  // Selection state for print / label preview
  const [activeBarcodeNode, setActiveBarcodeNode] = useState<HierarchyNode | null>(null);
  const [barWidth, setBarWidth] = useState<number>(2); // Multiplier for JsBarcode width
  const barcodeRef = useRef<SVGSVGElement>(null);

  // Colapsed node state
  const [collapsedNodes, setCollapsedNodes] = useState<Record<number, boolean>>({});

  // Real-time stock change animation flag
  const [highlightedNodes, setHighlightedNodes] = useState<Record<number, boolean>>({});

  // Active SSE connections
  const eventSourcesRef = useRef<Record<number, EventSource>>({});

  useEffect(() => {
    fetchHierarchy();
    fetchProducts();
    fetchSettings();

    return () => {
      // Close all SSE streams on unmount
      (Object.values(eventSourcesRef.current) as EventSource[]).forEach(es => es.close());
    };
  }, []);

  // Set up SSE listeners for live stock when nodes list updates
  useEffect(() => {
    // Clean up old ones
    (Object.values(eventSourcesRef.current) as EventSource[]).forEach(es => es.close());
    eventSourcesRef.current = {};

    // Create SSE for each node
    nodes.forEach(node => {
      const es = new EventSource(`/api/hierarchy/${node.id}/stock-live`);
      
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && typeof data.stock_real === 'number') {
            // Update node stock in state
            setNodes(prevNodes => 
              prevNodes.map(n => {
                if (n.id === node.id && n.stock_real !== data.stock_real) {
                  // Trigger micro-animation flash
                  setHighlightedNodes(prev => ({ ...prev, [node.id]: true }));
                  setTimeout(() => {
                    setHighlightedNodes(prev => ({ ...prev, [node.id]: false }));
                  }, 1200);

                  return { ...n, stock_real: data.stock_real };
                }
                return n;
              })
            );
          }
        } catch (e) {
          // Silent catch
        }
      };

      eventSourcesRef.current[node.id] = es;
    });
  }, [nodes.length]); // Re-attach when nodes list changes (items added/removed)

  const fetchHierarchy = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/hierarchy");
      if (resp.ok) {
        const data = await resp.json();
        setNodes(data);
      }
    } catch (e) {
      toast.error("Error al cargar la jerarquía de almacenamiento");
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const resp = await fetch("/api/productos");
      if (resp.ok) {
        const data = await resp.json();
        setProducts(Array.isArray(data) ? data : []);
      } else {
        setProducts([]);
      }
    } catch (e) {
      setProducts([]);
    }
  };

  const fetchSettings = async () => {
    try {
      const resp = await fetch("/api/hierarchy/settings");
      if (resp.ok) {
        const data = await resp.json();
        if (data.tipos_contenedor) {
          setSettings(data);
        }
      }
    } catch (e) {}
  };

  // Generate SVG Code128 using JsBarcode in modal
  useEffect(() => {
    if (showBarcodeModal && activeBarcodeNode && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, activeBarcodeNode.codigo_barras, {
          format: "CODE128",
          width: barWidth, // Dynamic bar spacing (multiplier)
          height: 70,
          displayValue: true,
          fontSize: 14,
          fontOptions: "bold",
          font: "monospace",
          textMargin: 6,
          background: "#ffffff",
          lineColor: "#000000",
          margin: 10
        });
      } catch (err) {
        console.error("JsBarcode generation failed:", err);
      }
    }
  }, [showBarcodeModal, activeBarcodeNode, barWidth]);

  const handleAddNode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const parent_id = selectedParentId === "null" ? null : parseInt(selectedParentId);
      const resp = await fetch("/api/hierarchy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_id,
          tipo_almacen: newTipo,
          sku_asociado: newSku || null,
          stock_real: newStock === "" ? 0 : newStock,
          codigo_barras: customBarcode || null
        })
      });

      if (resp.ok) {
        toast.success("Contenedor jerárquico creado correctamente");
        setShowAddModal(false);
        setNewSku("");
        setNewStock(0);
        setCustomBarcode("");
        setSelectedParentId("null");
        fetchHierarchy();
        fetchSettings(); // Auto-sequence update
      } else {
        const err = await resp.json();
        toast.error(err.error || "Error al crear nodo");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteNode = async (id: number) => {
    if (!window.confirm("¿Seguro que deseas eliminar este contenedor? Se eliminarán todos sus contenedores hijos.")) return;
    try {
      const resp = await fetch(`/api/hierarchy/${id}`, { method: "DELETE" });
      if (resp.ok) {
        toast.success("Contenedor eliminado");
        fetchHierarchy();
      } else {
        toast.error("Error al eliminar contenedor");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const sanitizedSecuencias = Object.fromEntries(
        Object.entries(settings.secuencias).map(([k, v]) => [k, v === "" ? 1 : v])
      );
      const resp = await fetch("/api/hierarchy/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          secuencias: sanitizedSecuencias
        })
      });
      if (resp.ok) {
        toast.success("Ajustes guardados correctamente");
        setShowSettingsModal(false);
      } else {
        toast.error("Error al guardar ajustes");
      }
    } catch (e) {
      toast.error("Error al conectar con servidor");
    }
  };

  const toggleCollapse = (id: number) => {
    setCollapsedNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const printLabel = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow || !barcodeRef.current) return;

    const svgHtml = barcodeRef.current.outerHTML;

    printWindow.document.write(`
      <html>
        <head>
          <title>Impresión de Etiqueta</title>
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              font-family: system-ui, sans-serif;
              text-align: center;
            }
            .label-card {
              border: 1px solid #ccc;
              padding: 20px;
              border-radius: 8px;
              background: white;
            }
            .info {
              margin-top: 10px;
              font-size: 14px;
              font-weight: bold;
              text-transform: uppercase;
            }
          </style>
        </head>
        <body>
          <div class="label-card">
            ${svgHtml}
            <div class="info">
              TIPO: ${activeBarcodeNode?.tipo_almacen} <br/>
              CODE: ${activeBarcodeNode?.codigo_barras}
              ${activeBarcodeNode?.sku_asociado ? `<br/>SKU: ${activeBarcodeNode?.sku_asociado}` : ""}
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Build tree from flat array list
  const buildTree = (nodesList: HierarchyNode[], parentId: number | null): any[] => {
    return nodesList
      .filter(n => n.parent_id === parentId)
      .map(n => ({
        ...n,
        children: buildTree(nodesList, n.id)
      }));
  };

  const treeData = buildTree(nodes, null);

  // Recursive Tree Component
  const TreeNode = ({ node }: { node: any }) => {
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = collapsedNodes[node.id] || false;
    const isHighlighted = highlightedNodes[node.id] || false;

    return (
      <div className="pl-4 border-l border-neutral-200/60 ml-2 mt-2">
        <div 
          className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-2xl gap-3 transition-all duration-300 border bg-white hover:border-neutral-300 hover:shadow-sm ${
            isHighlighted 
              ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-400 scale-[1.01]" 
              : "border-neutral-100"
          }`}
        >
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button 
                onClick={() => toggleCollapse(node.id)} 
                className="p-1 hover:bg-neutral-100 rounded-lg text-neutral-500"
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </button>
            ) : (
              <div className="w-6 h-6 flex items-center justify-center text-neutral-300">
                •
              </div>
            )}
            
            <Folder size={18} className="text-amber-500 shrink-0" />
            
            <div className="flex flex-col">
              <span className="font-extrabold text-neutral-800 text-sm capitalize">
                {node.tipo_almacen} 
                <span className="text-xs text-neutral-400 font-mono font-medium ml-2 uppercase">({node.codigo_barras})</span>
              </span>
              {node.sku_asociado && (
                <span className="text-[10px] bg-neutral-100 border text-neutral-700 px-2 py-0.5 rounded-full font-mono mt-1 font-bold w-fit">
                  SKU: {node.sku_asociado}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <div className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-100 px-3 py-1 rounded-xl text-neutral-700">
              <span className="text-[10px] font-black uppercase text-neutral-400">Stock:</span>
              <span className="text-sm font-black">{node.stock_real}</span>
            </div>

            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-xl text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 border"
                onClick={() => {
                  setActiveBarcodeNode(node);
                  setShowBarcodeModal(true);
                }}
                title="Generar Etiqueta Code128"
              >
                <Barcode size={14} />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 rounded-xl text-rose-600 hover:bg-rose-50 border border-rose-100"
                onClick={() => handleDeleteNode(node.id)}
                title="Eliminar Contenedor"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div className="space-y-1">
            {node.children.map((child: any) => (
              // @ts-ignore
              <TreeNode key={child.id} node={child} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 md:p-6 rounded-3xl border border-neutral-100 shadow-sm">
        <div>
          <h2 className="text-3xl font-black tracking-tight flex items-center gap-3 text-neutral-900 uppercase">
            <Network size={32} className="text-neutral-400" /> Jerarquía de Almacenamiento
          </h2>
          <p className="text-sm text-neutral-500 font-medium">Gestiona ubicaciones, estantes y contenedores en árbol jerárquico</p>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            onClick={() => setShowSettingsModal(true)} 
            variant="outline" 
            className="rounded-2xl h-11 px-5 border-neutral-200 text-neutral-700 font-bold bg-white"
          >
            <Settings className="mr-2" size={18} /> Ajustes
          </Button>
          <Button 
            onClick={() => setShowAddModal(true)} 
            className="rounded-2xl h-11 px-5 bg-neutral-900 text-white font-bold"
          >
            <Plus className="mr-2" size={18} /> Nuevo Contenedor
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-none shadow-lg rounded-3xl overflow-hidden bg-white">
          <CardHeader className="bg-neutral-50 border-b pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Mapa Jerárquico de Ubicaciones</CardTitle>
                <CardDescription className="text-neutral-500">
                  Visualización en tiempo real y árbol interactivo de contenedores de stock
                </CardDescription>
              </div>
              <Badge className="bg-emerald-500 border-none hover:bg-emerald-600 gap-1 flex items-center">
                <RefreshCw size={12} className="animate-spin" /> SSE Activo
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-6 pb-8 min-h-[300px]">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
                <Loader2 className="animate-spin mb-3 text-neutral-950" size={36} />
                <p className="font-semibold">Cargando mapa de almacén...</p>
              </div>
            ) : treeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-neutral-400 border-2 border-dashed rounded-3xl">
                <Folder size={48} className="opacity-20 mb-4" />
                <p className="font-semibold">No hay contenedores registrados en la jerarquía</p>
                <p className="text-xs text-neutral-500 mt-1 mb-5">Comienza creando tu primera bodega o estante principal</p>
                <Button onClick={() => setShowAddModal(true)} className="rounded-full bg-neutral-900">
                  Crear Primer Contenedor
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pr-2 overflow-x-auto">
                {treeData.map((node) => (
                  // @ts-ignore
                  <TreeNode key={node.id} node={node} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal Ajustes de Almacén */}
      <Dialog open={showSettingsModal} onOpenChange={setShowSettingsModal}>
        <DialogContent className="rounded-3xl max-w-lg p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
              <Settings className="text-neutral-500" />
              Ajustes de Prefijos y Secuencias
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveSettings} className="space-y-5 pt-4">
            <p className="text-xs text-neutral-500">
              Personaliza el prefijo y número de secuencia inicial que se usarán para generar los códigos de barras de cada tipo de contenedor.
            </p>
            
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
              {settings.tipos_contenedor.map((tipo: string) => (
                <div key={tipo} className="grid grid-cols-3 gap-3 items-center border-b pb-3 border-neutral-100 last:border-0 last:pb-0">
                  <span className="font-bold text-sm text-neutral-700 capitalize">{tipo}:</span>
                  <div>
                    <label className="text-[8px] uppercase font-black text-neutral-400 block mb-0.5">Prefijo</label>
                    <Input 
                      value={settings.prefijos[tipo] || ""}
                      onChange={(e) => setSettings({
                        ...settings,
                        prefijos: { ...settings.prefijos, [tipo]: e.target.value.toUpperCase() }
                      })}
                      className="rounded-xl h-9"
                    />
                  </div>
                  <div>
                    <label className="text-[8px] uppercase font-black text-neutral-400 block mb-0.5">Secuencia Actual</label>
                    <Input 
                      type="number"
                      value={settings.secuencias[tipo] !== undefined ? settings.secuencias[tipo] : 1}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSettings({
                          ...settings,
                          secuencias: { ...settings.secuencias, [tipo]: val === "" ? "" : (parseInt(val) || 1) }
                        });
                      }}
                      className="rounded-xl h-9 text-center font-bold"
                    />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="pt-4 border-t flex gap-2">
              <Button type="button" variant="outline" onClick={() => setShowSettingsModal(false)} className="rounded-xl flex-1">
                Cancelar
              </Button>
              <Button type="submit" className="rounded-xl flex-1 bg-neutral-900 text-white font-bold">
                <Save size={16} className="mr-2" /> Guardar Ajustes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal Nuevo Contenedor */}
      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="rounded-3xl max-w-md p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase flex items-center gap-2">
              <Plus /> Agregar Nuevo Contenedor
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddNode} className="space-y-4 pt-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Contenedor Padre</label>
              <select
                value={selectedParentId}
                onChange={e => setSelectedParentId(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="null">Ninguno (Contenedor Raíz / Bodega Principal)</option>
                {nodes.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.tipo_almacen.toUpperCase()} ({n.codigo_barras})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Tipo de Contenedor</label>
              <select
                value={newTipo}
                onChange={e => setNewTipo(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900 capitalize"
              >
                {settings.tipos_contenedor.map((t: string) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-neutral-400">Asociar Producto (Opcional)</label>
              <select
                value={newSku}
                onChange={e => setNewSku(e.target.value)}
                className="w-full rounded-xl h-11 px-3 bg-white border border-neutral-200 text-xs font-semibold outline-none focus:ring-1 focus:ring-neutral-900"
              >
                <option value="">No asociar producto específico</option>
                {products.map(p => (
                  <option key={p.id_producto} value={p.sku}>
                    {p.sku} - {p.marca_sub} ({p.talla})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-neutral-400">Código de Barras Personalizado (Opcional)</label>
                <Input 
                  placeholder="Dejar vacío para autogenerar"
                  value={customBarcode}
                  onChange={e => setCustomBarcode(e.target.value.toUpperCase())}
                  className="rounded-xl h-11"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-neutral-400">Stock Inicial</label>
                <Input 
                  type="number"
                  min={0}
                  value={newStock}
                  onChange={e => {
                    const val = e.target.value;
                    setNewStock(val === "" ? "" : (parseInt(val) || 0));
                  }}
                  className="rounded-xl h-11 text-center font-bold"
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t flex gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} className="rounded-xl flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting} className="rounded-xl flex-1 bg-neutral-900 text-white font-bold">
                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : "Crear Contenedor"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Código de Barras y Etiquetas */}
      <Dialog open={showBarcodeModal} onOpenChange={setShowBarcodeModal}>
        <DialogContent className="rounded-3xl max-w-sm p-6 text-center">
          <DialogHeader>
            <DialogTitle className="text-xl font-black uppercase text-neutral-900">
              Etiqueta de Contenedor
            </DialogTitle>
          </DialogHeader>
          
          <div className="bg-white p-4 rounded-2xl border shadow-inner mt-4 flex flex-col items-center justify-center">
            <svg ref={barcodeRef} className="max-w-full"></svg>
            <div className="mt-2 text-xs font-black uppercase tracking-wider text-neutral-700">
              Tipo: {activeBarcodeNode?.tipo_almacen}
              {activeBarcodeNode?.sku_asociado && <div className="text-[10px] text-neutral-500 font-mono mt-1 font-bold">SKU ASOCIADO: {activeBarcodeNode.sku_asociado}</div>}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between text-xs px-2">
              <span className="font-bold text-neutral-600">Densidad (Espaciado Barras):</span>
              <div className="flex items-center gap-1.5">
                <Button 
                  onClick={() => setBarWidth(Math.max(1, barWidth - 1))} 
                  variant="outline" 
                  className="h-7 w-7 rounded-lg p-0 font-bold"
                  title="Reducir densidad (mínimo 1mm)"
                >
                  -
                </Button>
                <span className="font-black w-6 text-center">{barWidth}px</span>
                <Button 
                  onClick={() => setBarWidth(barWidth + 1)} 
                  variant="outline" 
                  className="h-7 w-7 rounded-lg p-0 font-bold"
                  title="Aumentar densidad"
                >
                  +
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => setShowBarcodeModal(false)} 
                className="flex-1 rounded-xl h-11 text-xs"
              >
                Cerrar
              </Button>
              <Button 
                onClick={printLabel} 
                className="flex-1 rounded-xl h-11 bg-neutral-900 text-white font-bold text-xs gap-1.5"
              >
                <Printer size={14} /> Imprimir Etiqueta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
