import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { 
  Boxes, Package, Scan, LayoutDashboard, Tag, Warehouse, TrendingUp
} from "lucide-react";
import InventoryView from "./components/InventoryView";
import CajasView from "./components/CajasView";
import ScannerView from "./components/ScannerView";
import ConceptosView from "./components/ConceptosView";
import AlmacenView from "./components/AlmacenView";
import ConsultaDashboard from "./components/ConsultaDashboard";
import ImageLightbox from "./components/ImageLightbox";
import POSView from "./components/POSView";
import InventoryControlView from "./components/InventoryControlView";
import AlphaDashboardView from "./components/AlphaDashboardView";
import SyncStatusBadge from "./components/SyncStatusBadge";
import UpdateNotification from "./components/UpdateNotification";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname.toLowerCase());
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("activeTab") || "dashboard";
  });
  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setActiveTab(customEvent.detail);
      }
    };
    window.addEventListener("switch-tab", handleSwitchTab);
    return () => window.removeEventListener("switch-tab", handleSwitchTab);
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname.toLowerCase());
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const res = await fetch("/api/app-version");
        if (res.ok) {
          const data = await res.json();
          const localVer = localStorage.getItem("app_version");
          if (localVer && localVer !== data.version) {
            console.log(`Versión desactualizada (${localVer} -> ${data.version}). Buscando actualizaciones...`);
            if ("serviceWorker" in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              for (const r of regs) {
                await r.update();
              }
            }
            localStorage.setItem("app_version", data.version);
          } else if (!localVer) {
            localStorage.setItem("app_version", data.version);
          }
        }
      } catch (e) {
        console.error("Error al verificar la versión de la app:", e);
      }
    };

    checkVersion();
    window.addEventListener("focus", checkVersion);
    return () => window.removeEventListener("focus", checkVersion);
  }, []);


  // Helper to standardise route checks
  const pathMatches = (routes: string[]) => {
    const cleanPath = currentPath.replace(/\/$/, ""); // Strip trailing slash
    return routes.includes(cleanPath);
  };

  // 1. Dashboard / Consulta View
  if (pathMatches(["/dashboard", "/consulta"])) {
    return (
      <>
        <ConsultaDashboard />
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
        <UpdateNotification />
      </>
    );
  }

  // 2. Dedicated POS View (Vendedor)
  if (pathMatches(["/pos"])) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-6">
        <AppHeader subtitle="POS" />
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <POSView />
        </main>
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
        <UpdateNotification />
      </div>
    );
  }

  // 3. Dedicated Physical Count View (Operario Conteo)
  if (pathMatches(["/conteo_inv"])) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-6">
        <AppHeader subtitle="CONTEO" />
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <InventoryControlView userRole="operator" />
        </main>
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
        <UpdateNotification />
      </div>
    );
  }

  // 4. Dedicated Admin Panel View (Control Gerencial de Inventario y Aprobaciones)
  if (pathMatches(["/admin"])) {
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-6">
        <AppHeader subtitle="CONTEO ADMIN" />
        <main className="container mx-auto p-4 md:p-6 lg:p-8">
          <InventoryControlView userRole="manager" />
        </main>
        <ImageLightbox />
        <Toaster position="top-center" expand={true} richColors />
        <UpdateNotification />
      </div>
    );
  }

  // 5. Default Main App Layout (/ or /alpha)
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans pb-24 md:pb-6 min-w-0 overflow-x-hidden">
      <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md">
        <div className="container mx-auto max-w-full flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
            <div className="bg-neutral-950 p-1.5 rounded-lg text-white">
              <Boxes size={22} />
            </div>
            <span className="font-extrabold tracking-tight">INVENTARIO <span className="text-neutral-400 font-medium text-sm ml-1">| ALPHA</span></span>
          </div>
          
          <div className="flex items-center gap-2">
            {localStorage.getItem("app_version") && (
              <span className="text-[10px] font-black tracking-widest text-neutral-400 bg-neutral-100 px-2.5 py-1 rounded-full uppercase">
                v{localStorage.getItem("app_version")}
              </span>
            )}
            <SyncStatusBadge />
            <nav className="hidden xl:flex items-center gap-1 bg-neutral-100 p-1 rounded-xl">
              <TabButton 
                active={activeTab === "dashboard"} 
                onClick={() => setActiveTab("dashboard")}
                icon={<TrendingUp size={15} />}
                label="Dashboard"
              />
              <TabButton 
                active={activeTab === "scanner"} 
                onClick={() => setActiveTab("scanner")}
                icon={<Scan size={15} />}
                label="Escanear"
              />
              <TabButton 
                active={activeTab === "inventory"} 
                onClick={() => setActiveTab("inventory")}
                icon={<Package size={15} />}
                label="Productos"
              />
              <TabButton 
                active={activeTab === "boxes"} 
                onClick={() => setActiveTab("boxes")}
                icon={<LayoutDashboard size={15} />}
                label="Contenedores"
              />
              <TabButton 
                active={activeTab === "concepts"} 
                onClick={() => setActiveTab("concepts")}
                icon={<Tag size={15} />}
                label="Conceptos"
              />
              <TabButton 
                active={activeTab === "almacen"} 
                onClick={() => setActiveTab("almacen")}
                icon={<Warehouse size={15} />}
                label="Almacén"
              />
            </nav>
          </div>
        </div>
      </header>

      {/* Main navigation menu for standard desktop sizes (flexible grid) */}
      <div className="hidden md:flex xl:hidden container mx-auto px-4 pt-4 justify-center">
        <nav className="flex items-center flex-wrap gap-1 bg-neutral-100 p-1 rounded-xl">
          <TabButton 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")}
            icon={<TrendingUp size={15} />}
            label="Dashboard"
          />
          <TabButton 
            active={activeTab === "scanner"} 
            onClick={() => setActiveTab("scanner")}
            icon={<Scan size={15} />}
            label="Escanear"
          />
          <TabButton 
            active={activeTab === "inventory"} 
            onClick={() => setActiveTab("inventory")}
            icon={<Package size={15} />}
            label="Productos"
          />
          <TabButton 
            active={activeTab === "boxes"} 
            onClick={() => setActiveTab("boxes")}
            icon={<LayoutDashboard size={15} />}
            label="Contenedores"
          />
          <TabButton 
            active={activeTab === "concepts"} 
            onClick={() => setActiveTab("concepts")}
            icon={<Tag size={15} />}
            label="Conceptos"
          />
          <TabButton 
            active={activeTab === "almacen"} 
            onClick={() => setActiveTab("almacen")}
            icon={<Warehouse size={15} />}
            label="Almacén"
          />
        </nav>
      </div>

      <main className="container mx-auto max-w-full p-4 md:p-6 lg:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === "dashboard" && <AlphaDashboardView />}
            {activeTab === "scanner" && <ScannerView />}
            {activeTab === "inventory" && <InventoryView />}
            {activeTab === "boxes" && <CajasView />}
            {activeTab === "concepts" && <ConceptosView />}
            {activeTab === "almacen" && <AlmacenView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-neutral-100 flex gap-1 px-2 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] z-50 overflow-x-auto shadow-[0_-4px_16px_rgba(0,0,0,0.04)] justify-around">
        <MobileNavButton 
          active={activeTab === "dashboard"} 
          onClick={() => setActiveTab("dashboard")}
          icon={<TrendingUp size={20} />}
          label="Dash"
        />
        <MobileNavButton 
          active={activeTab === "scanner"} 
          onClick={() => setActiveTab("scanner")}
          icon={<Scan size={20} />}
          label="Scan"
        />
        <MobileNavButton 
          active={activeTab === "inventory"} 
          onClick={() => setActiveTab("inventory")}
          icon={<Package size={20} />}
          label="Stock"
        />
        <MobileNavButton 
          active={activeTab === "boxes"} 
          onClick={() => setActiveTab("boxes")}
          icon={<LayoutDashboard size={20} />}
          label="Contenedores"
        />
        <MobileNavButton 
          active={activeTab === "concepts"} 
          onClick={() => setActiveTab("concepts")}
          icon={<Tag size={20} />}
          label="Conceptos"
        />
        <MobileNavButton 
          active={activeTab === "almacen"} 
          onClick={() => setActiveTab("almacen")}
          icon={<Warehouse size={20} />}
          label="Almacén"
        />
      </nav>

      <ImageLightbox />
      <Toaster position="top-center" expand={true} richColors />
      <UpdateNotification />
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 font-bold text-xs ${
        active 
          ? "bg-white text-neutral-900 shadow-sm" 
          : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-colors px-2 min-w-0 flex-1 text-center ${
        active ? "text-neutral-900" : "text-neutral-400"
      }`}
    >
      {icon}
      <span className="text-[8px] font-black uppercase tracking-wider truncate max-w-full">{label}</span>
    </button>
  );
}

function AppHeader({ subtitle, actionLabel, actionUrl }: { subtitle: string, actionLabel?: string, actionUrl?: string }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur-md no-print">
      <div className="container mx-auto max-w-full flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight cursor-pointer" onClick={() => window.location.href = "/"}>
          <div className="bg-neutral-950 p-1.5 rounded-lg text-white">
            <Boxes size={22} />
          </div>
          <span className="font-extrabold tracking-tight">
            INVENTARIO <span className="text-neutral-400 font-medium text-sm ml-1">| {subtitle}</span>
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {localStorage.getItem("app_version") && (
            <span className="text-[10px] font-black tracking-widest text-neutral-400 bg-neutral-100 px-2.5 py-1 rounded-full uppercase">
              v{localStorage.getItem("app_version")}
            </span>
          )}
          <SyncStatusBadge />
          {actionLabel && actionUrl && (
            <button 
              onClick={() => window.location.href = actionUrl}
              className="text-xs font-bold text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-all border border-neutral-200"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
