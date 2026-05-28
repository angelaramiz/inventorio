import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, RefreshCw, Package, Layers, ShoppingCart, 
  ArrowUpRight, TrendingUp, AlertCircle, Sparkles, Building2, CheckCircle2
} from "lucide-react";
import { toast } from "sonner";

interface DashboardStats {
  totalSKUs: number;
  totalUnits: number;
  boxStats: {
    total: number;
    vacia: number;
    activa: number;
    llena: number;
  };
  layoutStats: {
    zonas: number;
    pasillos: number;
    secciones: number;
    niveles: number;
  };
  recentExits: Array<{
    id: number;
    vendedor_id: string;
    tipo_salida: string;
    created_at: string;
    total_unidades: number;
    detalles: Array<{
      sku: string;
      talla: string;
      marca: string;
      cantidad: number;
    }>;
  }>;
  brandCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

export default function AlphaDashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async (showToast = false) => {
    if (showToast) setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        if (showToast) toast.success("Estadísticas actualizadas");
      } else {
        toast.error("Error al cargar las estadísticas del sistema");
      }
    } catch (e) {
      toast.error("Error de conexión al cargar estadísticas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-amber-500" size={40} />
        <p className="text-neutral-500 text-sm font-semibold">Cargando estadísticas del sistema...</p>
      </div>
    );
  }

  // Format date helper
  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return isoString;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1 bg-amber-100 rounded-lg text-amber-600">
              <Sparkles size={16} className="animate-pulse" />
            </span>
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600">Panel de Control</span>
          </div>
          <h1 className="text-3xl font-black text-neutral-900 uppercase leading-none">DASHBOARD ALPHA</h1>
          <p className="text-xs text-neutral-500 font-medium">Visualización de estadísticas del sistema, historial y distribución física</p>
        </div>

        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 self-start md:self-center px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Actualizando..." : "Actualizar Dashboard"}
        </button>
      </div>

      {/* Grid de Métricas Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Prendas */}
        <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-gradient-to-br from-amber-500 to-amber-600 text-white">
          <CardContent className="p-6 relative">
            <div className="absolute right-4 top-4 opacity-15">
              <Package size={80} />
            </div>
            <p className="text-xs font-bold text-amber-100 uppercase tracking-wider">Prendas en Sistema</p>
            <h3 className="text-4xl font-black mt-2 font-mono">{stats?.totalUnits.toLocaleString() || 0}</h3>
            <div className="flex items-center gap-1.5 mt-4 text-xs font-medium text-amber-100 bg-white/10 w-fit px-2.5 py-1 rounded-full">
              <TrendingUp size={12} />
              <span>Stock físico total</span>
            </div>
          </CardContent>
        </Card>

        {/* Modelos Únicos */}
        <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white">
          <CardContent className="p-6 relative">
            <div className="absolute right-4 top-4 text-neutral-100">
              <Layers size={80} />
            </div>
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Modelos Registrados</p>
            <h3 className="text-4xl font-black text-neutral-900 mt-2 font-mono">{stats?.totalSKUs.toLocaleString() || 0}</h3>
            <div className="flex items-center gap-1.5 mt-4 text-xs font-bold text-neutral-600 bg-neutral-50 w-fit px-2.5 py-1 rounded-full border border-neutral-100">
              <span>SKUs / Estilos únicos</span>
            </div>
          </CardContent>
        </Card>

        {/* Cajas */}
        <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white">
          <CardContent className="p-6">
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Contenedores / Cajas</p>
            <h3 className="text-4xl font-black text-neutral-900 mt-2 font-mono">{stats?.boxStats.total || 0}</h3>
            <div className="grid grid-cols-3 gap-2 mt-4 pt-1">
              <div className="text-center bg-neutral-50 rounded-xl p-1 border border-neutral-100">
                <p className="text-[10px] font-bold text-neutral-400 uppercase">Vacías</p>
                <p className="text-xs font-black text-neutral-700">{stats?.boxStats.vacia || 0}</p>
              </div>
              <div className="text-center bg-amber-50 rounded-xl p-1 border border-amber-100/50">
                <p className="text-[10px] font-bold text-amber-600 uppercase">Activas</p>
                <p className="text-xs font-black text-amber-700">{stats?.boxStats.activa || 0}</p>
              </div>
              <div className="text-center bg-emerald-50 rounded-xl p-1 border border-emerald-100/50">
                <p className="text-[10px] font-bold text-emerald-600 uppercase">Llenas</p>
                <p className="text-xs font-black text-emerald-700">{stats?.boxStats.llena || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Estructura Almacén */}
        <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white">
          <CardContent className="p-6">
            <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Estructura Almacén</p>
            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <div className="flex items-center gap-2 bg-neutral-50 px-2.5 py-1.5 rounded-xl border">
                <Building2 size={14} className="text-neutral-500" />
                <div>
                  <p className="text-[9px] font-bold text-neutral-400 uppercase">Zonas</p>
                  <p className="text-xs font-black text-neutral-800">{stats?.layoutStats.zonas || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-neutral-50 px-2.5 py-1.5 rounded-xl border">
                <Layers size={14} className="text-neutral-500" />
                <div>
                  <p className="text-[9px] font-bold text-neutral-400 uppercase">Niveles</p>
                  <p className="text-xs font-black text-neutral-800">{stats?.layoutStats.niveles || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-neutral-50 px-2.5 py-1.5 rounded-xl border">
                <Layers size={14} className="text-neutral-500" />
                <div>
                  <p className="text-[9px] font-bold text-neutral-400 uppercase">Pasillos</p>
                  <p className="text-xs font-black text-neutral-800">{stats?.layoutStats.pasillos || 0}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-neutral-50 px-2.5 py-1.5 rounded-xl border">
                <Layers size={14} className="text-neutral-500" />
                <div>
                  <p className="text-[9px] font-bold text-neutral-400 uppercase">Secciones</p>
                  <p className="text-xs font-black text-neutral-800">{stats?.layoutStats.secciones || 0}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contenedores de Historial y Distribuciones */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Historial de Transacciones (Salidas) */}
        <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white lg:col-span-2">
          <CardHeader className="bg-neutral-50 border-b pb-4">
            <CardTitle className="text-lg flex items-center gap-2 font-black text-neutral-900 uppercase">
              <ShoppingCart size={18} className="text-amber-500" />
              Historial Reciente de Salidas
            </CardTitle>
            <CardDescription className="text-xs text-neutral-500">
              Últimas salidas físicas registradas por venta o transferencia entre tiendas
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {!stats?.recentExits || stats.recentExits.length === 0 ? (
              <div className="p-12 text-center text-neutral-400 flex flex-col items-center justify-center gap-2">
                <ShoppingCart size={36} className="opacity-30" />
                <p className="font-semibold text-sm">No se han registrado salidas en el sistema</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-100 max-h-[500px] overflow-y-auto custom-scrollbar">
                {stats.recentExits.map((exit) => (
                  <div key={exit.id} className="p-4 md:p-5 hover:bg-neutral-50/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-neutral-800">
                          Registro #{exit.id}
                        </span>
                        <Badge 
                          variant="secondary"
                          className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full ${
                            exit.tipo_salida === "venta en pos"
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-indigo-100 text-indigo-800 border border-indigo-200"
                          }`}
                        >
                          {exit.tipo_salida}
                        </Badge>
                      </div>
                      
                      <p className="text-[11px] text-neutral-500 font-bold">
                        Operador: {exit.vendedor_id} • Fecha: {formatDate(exit.created_at)}
                      </p>

                      <div className="flex gap-1.5 flex-wrap pt-1">
                        {exit.detalles.slice(0, 3).map((det, dIdx) => (
                          <span key={dIdx} className="inline-flex items-center text-[10px] font-bold text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-md">
                            {det.sku} ({det.cantidad}u)
                          </span>
                        ))}
                        {exit.detalles.length > 3 && (
                          <span className="inline-flex items-center text-[10px] font-bold text-neutral-400 bg-neutral-50 px-2 py-0.5 rounded-md border border-dashed">
                            +{exit.detalles.length - 3} más
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-2 sm:pt-0 shrink-0">
                      <p className="text-[10px] text-neutral-400 font-bold sm:hidden">Total unidades:</p>
                      <Badge className="bg-neutral-900 text-white font-mono font-black text-xs px-3 py-1 rounded-xl">
                        {exit.total_unidades} {exit.total_unidades === 1 ? "PRENDA" : "PRENDAS"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Distribución de Inventario */}
        <div className="space-y-6">
          {/* Distribución por Sub-Marcas */}
          <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white">
            <CardHeader className="bg-neutral-50 border-b pb-4">
              <CardTitle className="text-md flex items-center gap-2 font-black text-neutral-900 uppercase">
                <Sparkles size={16} className="text-amber-500" />
                Top Marcas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3 max-h-[220px] overflow-y-auto custom-scrollbar">
              {Object.keys(stats?.brandCounts || {}).length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-4">No hay marcas registradas</p>
              ) : (
                (Object.entries(stats?.brandCounts || {}) as [string, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([brand, count]) => (
                    <div key={brand} className="flex justify-between items-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-100">
                      <span className="text-xs font-bold text-neutral-700">{brand}</span>
                      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 font-mono font-black text-xs px-2 py-0.5 rounded-lg border border-amber-200">
                        {count} {count === 1 ? "modelo" : "modelos"}
                      </Badge>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>

          {/* Distribución por Tipo de Producto */}
          <Card className="border-none shadow-md rounded-3xl overflow-hidden bg-white">
            <CardHeader className="bg-neutral-50 border-b pb-4">
              <CardTitle className="text-md flex items-center gap-2 font-black text-neutral-900 uppercase">
                <Layers size={16} className="text-neutral-500" />
                Categorías / Tipos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3 max-h-[220px] overflow-y-auto custom-scrollbar">
              {Object.keys(stats?.typeCounts || {}).length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-4">No hay tipos de productos registrados</p>
              ) : (
                (Object.entries(stats?.typeCounts || {}) as [string, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="flex justify-between items-center bg-neutral-50 p-2.5 rounded-xl border border-neutral-100">
                      <span className="text-xs font-bold text-neutral-700 uppercase">{type}</span>
                      <Badge className="bg-neutral-100 text-neutral-800 hover:bg-neutral-100 font-mono font-black text-xs px-2 py-0.5 rounded-lg border border-neutral-200">
                        {count} {count === 1 ? "modelo" : "modelos"}
                      </Badge>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
