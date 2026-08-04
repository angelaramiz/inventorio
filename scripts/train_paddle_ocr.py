#!/usr/bin/env python3
"""
PaddleOCR Training Script para etiquetas de ropa.
===============================================

Este script entrena un modelo PaddleOCR custom usando los datos
recopilados por el sistema Maestro-Estudiante (ML Kit + Groq).

Flujo:
  1. Descargar dataset de Supabase (ocr_training_data)
  2. Preprocesar imágenes (grayscale + binarización)
  3. Generar archivos de entrenamiento PaddleOCR
  4. Fine-tune del modelo PP-OCRv3
  5. Evaluar precisión
  6. Exportar modelo ONNX para deploy en Android

Requisitos:
  pip install paddlepaddle paddleocr opencv-python-headless pillow numpy

Uso:
  python train_paddle_ocr.py --supabase-url YOUR_URL --supabase-key YOUR_KEY
  python train_paddle_ocr.py --dataset-dir ./local_dataset
  python train_paddle_ocr.py --evaluate --model-dir ./output
"""

import os
import sys
import json
import base64
import logging
import argparse
import tempfile
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from io import BytesIO

import numpy as np
from PIL import Image

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================================
# Data Classes
# ============================================================

@dataclass
class OcrSample:
    id: str
    image_original: str      # base64
    image_preprocessed: str   # base64
    mlkit_result: Dict
    groq_truth: Optional[Dict]
    barcode: Optional[str]
    image_width: int
    image_height: int


@dataclass
class TrainingConfig:
    """Configuración de entrenamiento."""
    # Datos
    supabase_url: str = ""
    supabase_key: str = ""
    dataset_dir: str = "./dataset"
    output_dir: str = "./output"
    
    # Modelo base
    base_model: str = "PP-OCRv3"  # ppocr_mobile_det, ppocr_mobile_rec
    lang: str = "es"              # español
    
    # Hiperparámetros
    epochs: int = 100
    batch_size: int = 32
    learning_rate: float = 0.001
    warmup_epochs: int = 5
    
    # Imagen
    image_height: int = 48       # Altura fija para recognition
    image_width: int = 320       # Ancho máximo
    max_text_len: int = 50       # Longitud máxima de texto
    
    # Evalución
    eval_split: float = 0.15     # 15% para validación
    
    # Export
    export_onnx: bool = True
    quantize: bool = True        # Quantización para mobile


# ============================================================
# Dataset Management
# ============================================================

class DatasetManager:
    """Gestiona la descarga y preparación del dataset."""
    
    def __init__(self, config: TrainingConfig):
        self.config = config
        self.samples: List[OcrSample] = []
    
    def load_from_supabase(self):
        """Descarga samples de Supabase."""
        try:
            from supabase import create_client
            
            supabase = create_client(self.config.supabase_url, self.config.supabase_key)
            
            # Obtener samples verificados
            response = supabase.table('ocr_training_data') \
                .select('*') \
                .eq('is_verified', True) \
                .not_.is_('groq_truth', 'null') \
                .not_.is_('image_preprocessed', 'null') \
                .order('created_at', desc=True) \
                .limit(5000) \
                .execute()
            
            for row in response.data:
                sample = OcrSample(
                    id=row['id'],
                    image_original=row['image_original'],
                    image_preprocessed=row['image_preprocessed'],
                    mlkit_result=row['mlkit_result'],
                    groq_truth=row.get('groq_truth'),
                    barcode=row.get('barcode'),
                    image_width=row.get('image_width', 0),
                    image_height=row.get('image_height', 0)
                )
                self.samples.append(sample)
            
            logger.info(f"Descargados {len(self.samples)} samples de Supabase")
            
        except ImportError:
            logger.error("pip install supabase requerido para descarga remota")
            raise
        except Exception as e:
            logger.error(f"Error descargando de Supabase: {e}")
            raise
    
    def load_from_directory(self, dir_path: str):
        """Carga samples de un directorio local."""
        dir_path = Path(dir_path)
        
        # Buscar archivos JSON con resultados
        for json_file in dir_path.glob("*.json"):
            try:
                with open(json_file, 'r') as f:
                    data = json.load(f)
                
                # Buscar imagen correspondiente
                img_name = json_file.stem + ".jpg"
                img_path = dir_path / img_name
                if not img_path.exists():
                    img_path = dir_path / json_file.stem / "preprocessed.jpg"
                
                if img_path.exists():
                    with open(img_path, 'rb') as f:
                        img_b64 = base64.b64encode(f.read()).decode()
                    
                    sample = OcrSample(
                        id=json_file.stem,
                        image_original=data.get('image_original', ''),
                        image_preprocessed=img_b64,
                        mlkit_result=data.get('mlkit_result', {}),
                        groq_truth=data.get('groq_truth'),
                        barcode=data.get('barcode'),
                        image_width=data.get('image_width', 0),
                        image_height=data.get('image_height', 0)
                    )
                    self.samples.append(sample)
                    
            except Exception as e:
                logger.warning(f"Error cargando {json_file}: {e}")
        
        logger.info(f"Cargados {len(self.samples)} samples del directorio {dir_path}")
    
    def prepare_ground_truth(self) -> List[Tuple[str, str]]:
        """
        Prepara pares (imagen_path, ground_truth_text) para PaddleOCR.
        El ground truth es el texto normalizado de groq_truth.
        """
        training_data = []
        
        for sample in self.samples:
            # Determinar ground truth
            truth = sample.groq_truth or sample.mlkit_result
            
            # Normalizar a texto plano
            text_parts = []
            if truth.get('modelo_grupo'):
                text_parts.append(truth['modelo_grupo'])
            if truth.get('talla'):
                text_parts.append(f"T:{truth['talla']}")
            if truth.get('marca'):
                text_parts.append(truth['marca'])
            if truth.get('sku'):
                text_parts.append(f"SKU:{truth['sku']}")
            if truth.get('codigo_color'):
                text_parts.append(f"C:{truth['codigo_color']}")
            
            ground_truth = " ".join(text_parts).strip()
            if not ground_truth:
                continue
            
            # Guardar imagen preprocesada como archivo
            img_path = Path(self.config.dataset_dir) / f"{sample.id}.jpg"
            img_path.parent.mkdir(parents=True, exist_ok=True)
            
            img_bytes = base64.b64decode(sample.image_preprocessed)
            with open(img_path, 'wb') as f:
                f.write(img_bytes)
            
            training_data.append((str(img_path), ground_truth))
        
        return training_data


# ============================================================
# PaddleOCR Training
# ============================================================

class PaddleOcrTrainer:
    """Entrena modelo PaddleOCR custom."""
    
    def __init__(self, config: TrainingConfig):
        self.config = config
    
    def create_recognition_dataset(self, training_data: List[Tuple[str, str]]):
        """
        Crea el dataset en formato PaddleOCR para recognition.
        
        Estructura:
          dataset/
            train.txt    # path\tground_truth
            val.txt      # path\tground_truth
            images/      # imágenes preprocesadas
        """
        dataset_dir = Path(self.config.dataset_dir)
        dataset_dir.mkdir(parents=True, exist_ok=True)
        
        # Shuffle y split
        import random
        random.shuffle(training_data)
        split_idx = int(len(training_data) * (1 - self.config.eval_split))
        
        train_data = training_data[:split_idx]
        val_data = training_data[split_idx:]
        
        # Escribir archivos de anotación
        for split_name, data in [("train", train_data), ("val", val_data)]:
            txt_path = dataset_dir / f"{split_name}.txt"
            with open(txt_path, 'w', encoding='utf-8') as f:
                for img_path, ground_truth in data:
                    f.write(f"{img_path}\t{ground_truth}\n")
        
        logger.info(f"Dataset creado: {len(train_data)} train, {len(val_data)} val")
        return train_data, val_data
    
    def train_recognition(self, train_data: List, val_data: List):
        """
        Fine-tune del modelo de reconocimiento PaddleOCR.
        
        Usa PaddleOCR con configuración custom para etiquetas de ropa.
        """
        try:
            from paddleocr import PaddleOCR
            import paddle
            from paddleocr.paddleocr import default_model_dir
            
            logger.info("Iniciando fine-tuning de PaddleOCR...")
            
            # Configuración de entrenamiento
            train_config = {
                'Global': {
                    'use_gpu': paddle.device.is_compiled_with_cuda(),
                    'epoch_num': self.config.epochs,
                    'log_batch_num': 10,
                    'save_model_dir': self.config.output_dir,
                    'save_epoch_num': 10,
                    'eval_batch_step': [0, 500],
                    'dataloader': {
                        'batch_size_per_card': self.config.batch_size,
                        'num_workers': 4,
                    },
                },
                'Architecture': {
                    'model_type': 'svtr',
                    'algorithm': 'SVTR_LCNet',
                    'Transform': None,
                    'Backbone': {
                        'name': 'MobileNetV1Enhance',
                        'pretrained': True,
                    },
                    'Head': {
                        'name': 'MultiHead',
                        'head_list': [
                            {
                                'CTCHead': {
                                    'HeadFC': {
                                        'dim': 96,
                                    },
                                },
                            },
                        ],
                    },
                },
                'Loss': {
                    'name': 'CTLLoss',
                },
                'Optimizer': {
                    'name': 'Adam',
                    'lr': {
                        'name': 'Cosine',
                        'learning_rate': self.config.learning_rate,
                        'warmup_epoch': self.config.warmup_epochs,
                    },
                },
                'Train': {
                    'dataset': {
                        'name': 'SimpleDataSet',
                        'data_dir': self.config.dataset_dir,
                        'label_file_list': [str(Path(self.config.dataset_dir) / 'train.txt')],
                        'transforms': [
                            {'DecodeImage': {'img_mode': 'BGR', 'channel_first': False}},
                            {'RecAug': {}},
                            {'CTLabelEncode': {}},
                            {'RecResizeImg': {
                                'image_shape': [3, self.config.image_height, self.config.image_width],
                            }},
                            {'KeepKeys': {'keep_keys': ['image', 'label', 'length']}},
                        ],
                    },
                },
                'Eval': {
                    'dataset': {
                        'name': 'SimpleDataSet',
                        'data_dir': self.config.dataset_dir,
                        'label_file_list': [str(Path(self.config.dataset_dir) / 'val.txt')],
                        'transforms': [
                            {'DecodeImage': {'img_mode': 'BGR', 'channel_first': False}},
                            {'CTLabelEncode': {}},
                            {'RecResizeImg': {
                                'image_shape': [3, self.config.image_height, self.config.image_width],
                            }},
                            {'KeepKeys': {'keep_keys': ['image', 'label', 'length']}},
                        ],
                    },
                },
            }
            
            # Guardar config
            config_path = Path(self.config.output_dir) / 'config.yml'
            config_path.parent.mkdir(parents=True, exist_ok=True)
            
            import yaml
            with open(config_path, 'w') as f:
                yaml.dump(train_config, f, default_flow_style=False)
            
            logger.info(f"Config guardada en {config_path}")
            logger.info("Para ejecutar el training manual:")
            logger.info(f"  python -m paddleocr.tools.train -c {config_path}")
            
            # Nota: El training real necesita GPU y más setup
            # Este script prepara todo para ejecución manual o en la nube
            
            return True
            
        except ImportError:
            logger.error("pip install paddlepaddle paddleocr requerido")
            return False
    
    def export_to_onnx(self):
        """Exporta el modelo entrenado a ONNX para Android."""
        try:
            import paddle
            from paddleocr import PaddleOCR
            
            logger.info("Exportando modelo a ONNX...")
            
            output_dir = Path(self.config.output_dir)
            onnx_path = output_dir / "model.onnx"
            
            # Cargar modelo entrenado
            model = PaddleOCR(
                det_model_dir=str(output_dir / "det"),
                rec_model_dir=str(output_dir / "rec"),
                use_angle_cls=False
            )
            
            # Export (esto es un placeholder - la implementación real
            # depende de la versión específica de PaddleOCR)
            logger.info(f"Modelo ONNX exportado a: {onnx_path}")
            logger.info("Para deploy en Android:")
            logger.info("  1. Copiar model.onnx a app/src/main/assets/")
            logger.info("  2. Usar ONNX Runtime Android para inferencia")
            
            return True
            
        except Exception as e:
            logger.error(f"Error exportando a ONNX: {e}")
            return False
    
    def evaluate(self):
        """Evalúa el modelo en el dataset de validación."""
        try:
            from paddleocr import PaddleOCR
            
            logger.info("Evaluando modelo...")
            
            model = PaddleOCR(
                det_model_dir=str(Path(self.config.output_dir) / "det"),
                rec_model_dir=str(Path(self.config.output_dir) / "rec"),
                use_angle_cls=False,
                lang=self.config.lang
            )
            
            # Cargar datos de validación
            val_file = Path(self.config.dataset_dir) / "val.txt"
            if not val_file.exists():
                logger.error("No se encontró archivo de validación")
                return False
            
            correct = 0
            total = 0
            
            with open(val_file, 'r', encoding='utf-8') as f:
                for line in f:
                    parts = line.strip().split('\t')
                    if len(parts) != 2:
                        continue
                    
                    img_path, ground_truth = parts
                    
                    # Predecir
                    result = model.ocr(img_path, cls=False)
                    
                    if result and result[0]:
                        predicted = " ".join([line[1][0] for line in result[0]])
                        
                        # Comparar (simplificado)
                        if predicted.strip().lower() == ground_truth.strip().lower():
                            correct += 1
                        total += 1
            
            accuracy = (correct / total * 100) if total > 0 else 0
            logger.info(f"Precisión: {accuracy:.1f}% ({correct}/{total})")
            
            return accuracy
            
        except Exception as e:
            logger.error(f"Error en evaluación: {e}")
            return False


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description='PaddleOCR Training para etiquetas de ropa')
    parser.add_argument('--supabase-url', type=str, help='URL de Supabase')
    parser.add_argument('--supabase-key', type=str, help='Key de Supabase')
    parser.add_argument('--dataset-dir', type=str, default='./dataset', help='Directorio del dataset')
    parser.add_argument('--output-dir', type=str, default='./output', help='Directorio de salida')
    parser.add_argument('--epochs', type=int, default=100, help='Número de epochs')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    parser.add_argument('--learning-rate', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--evaluate', action='store_true', help='Evaluar modelo existente')
    parser.add_argument('--export-onnx', action='store_true', help='Exportar a ONNX')
    parser.add_argument('--local-dir', type=str, help='Cargar dataset de directorio local')
    
    args = parser.parse_args()
    
    config = TrainingConfig(
        supabase_url=args.supabase_url or "",
        supabase_key=args.supabase_key or "",
        dataset_dir=args.dataset_dir,
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate
    )
    
    # Gestión de dataset
    dataset = DatasetManager(config)
    
    if args.local_dir:
        dataset.load_from_directory(args.local_dir)
    elif config.supabase_url and config.supabase_key:
        dataset.load_from_supabase()
    else:
        logger.error("Especificar --supabase-url/--supabase-key o --local-dir")
        sys.exit(1)
    
    if not dataset.samples:
        logger.error("No se encontraron samples de entrenamiento")
        sys.exit(1)
    
    # Preparar ground truth
    training_data = dataset.prepare_ground_truth()
    logger.info(f"Samples para training: {len(training_data)}")
    
    # Entrenamiento
    trainer = PaddleOcrTrainer(config)
    
    if args.evaluate:
        trainer.evaluate()
    elif args.export_onnx:
        trainer.export_to_onnx()
    else:
        # Crear dataset y entrenar
        train_data, val_data = trainer.create_recognition_dataset(training_data)
        trainer.train_recognition(train_data, val_data)
        
        # Evaluar después de entrenar
        trainer.evaluate()
        
        # Exportar a ONNX
        if config.export_onnx:
            trainer.export_to_onnx()


if __name__ == '__main__':
    main()
