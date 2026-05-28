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
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname.toLowerCase());
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname.toLowerCase());
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
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
              label="Cajas"
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
            label="Cajas"
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
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex gap-1 p-2 z-50 overflow-x-auto">
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
          label="Cajas"
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
        
        {actionLabel && actionUrl && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => window.location.href = actionUrl}
              className="text-xs font-bold text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-all border border-neutral-200"
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
