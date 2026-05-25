import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, Loader2, Image as ImageIcon, CheckCircle, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  productoId: number;
  hasFoto: boolean;
  onSuccess: () => void;
}

export default function AsyncImageUploader({ productoId, hasFoto, onSuccess }: Props) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<any>(null);

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, []);

  const startCamera = async () => {
    setShowCamera(true);
    setPhoto(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      toast.error("No se pudo acceder a la cámara");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    const targetSize = 600; // Visual lossless size
    let width = video.videoWidth;
    let height = video.videoHeight;

    if (width > height) {
      if (width > targetSize) {
        height *= targetSize / width;
        width = targetSize;
      }
    } else {
      if (height > targetSize) {
        width *= targetSize / height;
        height = targetSize;
      }
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, width, height);
      // Client-side WebP compression (visually lossless)
      const dataUrl = canvas.toDataURL("image/webp", 0.85);
      setPhoto(dataUrl);
      stopCamera();
      // Auto-trigger background upload
      uploadImageAsync(dataUrl);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const targetSize = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > targetSize) {
            height *= targetSize / width;
            width = targetSize;
          }
        } else {
          if (height > targetSize) {
            width *= targetSize / height;
            height = targetSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/webp", 0.85);
          setPhoto(dataUrl);
          uploadImageAsync(dataUrl);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const uploadImageAsync = async (dataUrl: string) => {
    setIsProcessing(true);
    setProgress(0);
    setStatusText("Preparando imagen...");

    try {
      // Convert Data URL to Blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      const fd = new FormData();
      fd.append("foto", blob, "producto.webp");

      setStatusText("Iniciando subida asíncrona...");
      const uploadResp = await fetch(`/api/productos/${productoId}/async-image`, {
        method: "POST",
        body: fd
      });

      if (!uploadResp.ok) {
        throw new Error("No se pudo iniciar la carga en el servidor");
      }

      const { taskId } = await uploadResp.json();
      
      // Start polling for task status
      pollTaskStatus(taskId);
    } catch (err: any) {
      toast.error(err.message || "Error al subir imagen");
      setIsProcessing(false);
      setPhoto(null);
    }
  };

  const pollTaskStatus = (taskId: string) => {
    setStatusText("Procesando en segundo plano...");
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/image-tasks/${taskId}`);
        if (resp.ok) {
          const task = await resp.json();
          setProgress(task.progress);

          if (task.status === "completed") {
            clearInterval(pollingIntervalRef.current);
            setIsProcessing(false);
            toast.success("Imagen procesada y optimizada en WebP con éxito!");
            onSuccess();
          } else if (task.status === "failed") {
            clearInterval(pollingIntervalRef.current);
            setIsProcessing(false);
            toast.error(`Error al optimizar imagen: ${task.error}`);
            setPhoto(null);
          }
        }
      } catch (e) {
        // Silent catch during polling errors
      }
    }, 400);
  };

  const handleDeletePhoto = async () => {
    if (!window.confirm("¿Seguro que deseas eliminar la foto de este producto?")) return;
    try {
      const resp = await fetch(`/api/productos/${productoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete_foto: "true" })
      });
      if (resp.ok) {
        toast.success("Foto eliminada correctamente");
        setPhoto(null);
        onSuccess();
      } else {
        toast.error("Error al eliminar la foto");
      }
    } catch (e) {
      toast.error("Error de conexión");
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 bg-neutral-50 p-6 rounded-3xl border border-neutral-100 w-full">
      <div className="relative group">
        {showCamera ? (
          <div className="relative w-40 h-40 bg-black rounded-3xl overflow-hidden shadow-lg border border-neutral-200">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-3 left-0 right-0 flex justify-center">
              <button 
                type="button" 
                onClick={capturePhoto} 
                className="rounded-full h-11 w-11 bg-white hover:bg-neutral-100 flex items-center justify-center shadow-xl border-4 border-neutral-900/10 active:scale-95 transition-all"
              >
                <div className="h-6 w-6 rounded-full border-2 border-neutral-800 bg-neutral-900/10"></div>
              </button>
            </div>
          </div>
        ) : isProcessing ? (
          <div className="w-40 h-40 bg-neutral-900 rounded-3xl flex flex-col items-center justify-center text-white px-4 text-center relative overflow-hidden shadow-xl border border-neutral-800">
            <div className="absolute inset-0 bg-neutral-950/20" />
            <Loader2 className="animate-spin text-neutral-400 mb-3 relative z-10" size={32} />
            <p className="text-[11px] font-black tracking-tight uppercase relative z-10">{statusText}</p>
            <div className="w-24 bg-neutral-800 h-2 rounded-full overflow-hidden mt-3 relative z-10 border border-neutral-700/50">
              <div 
                className="bg-emerald-400 h-full transition-all duration-300 rounded-full" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <span className="text-[10px] font-black text-emerald-400 mt-1 relative z-10">{progress}%</span>
          </div>
        ) : photo ? (
          <img src={photo} alt="Preview" className="w-40 h-40 object-cover rounded-3xl shadow-lg border-2 border-white" />
        ) : hasFoto ? (
          <img 
            src={`/api/productos/${productoId}/image?t=${new Date().getTime()}`} 
            alt="Actual" 
            className="w-40 h-40 object-cover rounded-3xl shadow-lg border-2 border-white" 
          />
        ) : (
          <div className="w-40 h-40 bg-white border-2 border-dashed border-neutral-200 rounded-3xl flex flex-col items-center justify-center text-neutral-400 shadow-inner">
            <ImageIcon size={36} strokeWidth={1.5} className="opacity-70" />
            <span className="text-[10px] font-black uppercase mt-2 tracking-wider text-neutral-400">Sin Imagen</span>
          </div>
        )}

        {!showCamera && !isProcessing && (photo || hasFoto) && (
          <button 
            type="button"
            onClick={handleDeletePhoto}
            className="absolute -top-2 -right-2 bg-rose-500 hover:bg-rose-600 text-white p-2 rounded-full shadow-lg transition-transform hover:scale-110"
            title="Eliminar foto"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex gap-2 w-full max-w-[280px]">
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          className="hidden" 
          accept="image/*"
        />
        {!showCamera && !isProcessing ? (
          <>
            <Button 
              type="button" 
              variant="outline" 
              className="flex-1 rounded-2xl gap-2 text-xs h-10 border-neutral-200 font-bold bg-white"
              onClick={startCamera}
            >
              <Camera size={14} /> Cámara
            </Button>
            <Button 
              type="button" 
              variant="outline" 
              className="flex-1 rounded-2xl gap-2 text-xs h-10 border-neutral-200 font-bold bg-white"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={14} /> Subir
            </Button>
          </>
        ) : showCamera ? (
          <Button 
            type="button" 
            variant="outline" 
            className="w-full rounded-2xl h-10 border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-xs"
            onClick={stopCamera}
          >
            Detener Cámara
          </Button>
        ) : null}
      </div>
    </div>
  );
}
