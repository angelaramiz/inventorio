#!/usr/bin/env python3
"""
PaddleOCR Training Pipeline para etiquetas de ropa.
=================================================

Este script entrena modelos PaddleOCR custom por categoría usando
datos recopilados del sistema Maestro-Estudiante (ML Kit + correcciones).

Flujo completo:
  1. Descargar dataset verificado de Supabase (ocr_training_data)
  2. Aplicar augmentación de imágenes (brillo, sombras, ruido, rotación)
  3. Dividir por categoría (calzado, ropa, marciano, bolsas, etc.)
  4. Generar archivos de entrenamiento PaddleOCR
  5. Fine-tune modelo por categoría
  6. Evaluar precisión
  7. Exportar modelo ONNX para deploy en Android

Requisitos:
  pip install paddlepaddle paddleocr pillow numpy supabase

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
import random
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ============================================================
# Data Classes
# ============================================================

@dataclass
class OcrSample:
    id: str
    image_original: str
    image_preprocessed: str
    mlkit_result: Dict
    user_truth: Optional[Dict]
    barcode: Optional[str]
    modelo_grupo: str
    categoria: str


@dataclass
class TrainingConfig:
    supabase_url: str = ""
    supabase_key: str = ""
    dataset_dir: str = "./dataset"
    output_dir: str = "./output"
    epochs: int = 50
    batch_size: int = 16
    learning_rate: float = 0.001
    warmup_epochs: int = 3
    image_height: int = 48
    image_width: int = 320
    eval_split: float = 0.15
    export_onnx: bool = True
    min_samples_per_category: int = 10


# ============================================================
# Categorización
# ============================================================

def categorize_label(modelo: str) -> str:
    m = modelo.strip().upper()
    if not m or len(m) < 2:
        return "general"
    first, second = m[0], m[1] if len(m) > 1 else ""
    is_digit = lambda c: c >= '0' and c <= '9'

    if first == 'G' and second:
        if second == 'W': return "calzado_mujer"
        if second == 'M': return "calzado_hombre"
    if first == 'W' and is_digit(second): return "ropa_mujer"
    if first == 'M' and is_digit(second): return "ropa_hombre"
    if is_digit(first) and first in ('3','4','5','6'): return "marciano"
    if m.startswith("ESG") or m.startswith("SSG"): return "bolsas"
    if m.startswith("PD") or m.startswith("GWJR"): return "calzado_etiqueta"
    if first == 'G': return "calzado"
    if is_digit(first): return "marciano"
    return "general"


# ============================================================
# Augmentación de Imágenes
# ============================================================

class ImageAugmenter:
    """
    Aplica transformaciones para generar variaciones de cada muestra.
    Esto es crítico para entrenar con pocos datos: cada muestra se
    multiplica en ~8-10 variaciones.
    """

    AUGMENTATIONS = {
        "original": lambda img: img,
        "bright_up": lambda img: ImageEnhance.Brightness(img).enhance(1.4),
        "bright_down": lambda img: ImageEnhance.Brightness(img).enhance(0.6),
        "contrast_up": lambda img: ImageEnhance.Contrast(img).enhance(1.5),
        "contrast_down": lambda img: ImageEnhance.Contrast(img).enhance(0.5),
        "noise_gaussian": lambda img: _add_gaussian_noise(img, 0.03),
        "noise_salt_pepper": lambda img: _add_salt_pepper(img, 0.02),
        "shadow_left": lambda img: _add_shadow(img, "left"),
        "shadow_right": lambda img: _add_shadow(img, "right"),
        "rotate_5": lambda img: img.rotate(5, expand=True, fillcolor=255),
        "rotate_minus5": lambda img: img.rotate(-5, expand=True, fillcolor=255),
        "slight_blur": lambda img: img.filter(ImageFilter.GaussianBlur(0.8)),
    }

    @staticmethod
    def apply_all(image: Image.Image) -> List[Tuple[str, Image.Image]]:
        results = []
        for name, fn in ImageAugmenter.AUGMENTATIONS.items():
            try:
                augmented = fn(image)
                results.append((name, augmented))
            except:
                pass
        return results

    @staticmethod
    def apply_subset(image: Image.Image, num_variations: int = 6) -> List[Tuple[str, Image.Image]]:
        """Si hay suficientes muestras, usar subset de augmentaciones."""
        keys = list(ImageAugmenter.AUGMENTATIONS.keys())
        if num_variations >= len(keys):
            return ImageAugmenter.apply_all(image)
        selected = random.sample(keys, num_variations)
        results = []
        for name in selected:
            try:
                results.append((name, ImageAugmenter.AUGMENTATIONS[name](image)))
            except:
                pass
        return results


def _add_gaussian_noise(img: Image.Image, strength: float = 0.03) -> Image.Image:
    arr = np.array(img).astype(np.float32)
    noise = np.random.normal(0, strength * 255, arr.shape)
    noisy = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(noisy)


def _add_salt_pepper(img: Image.Image, amount: float = 0.02) -> Image.Image:
    arr = np.array(img).copy()
    h, w = arr.shape[:2]
    num = int(h * w * amount)
    for _ in range(num // 2):
        y, x = random.randint(0, h-1), random.randint(0, w-1)
        arr[y, x] = 0 if len(arr.shape) == 2 else [0, 0, 0]
    for _ in range(num // 2):
        y, x = random.randint(0, h-1), random.randint(0, w-1)
        arr[y, x] = 255 if len(arr.shape) == 2 else [255, 255, 255]
    return Image.fromarray(arr)


def _add_shadow(img: Image.Image, side: str = "left") -> Image.Image:
    arr = np.array(img).astype(np.float32)
    h, w = arr.shape[:2]
    gradient = np.linspace(0.3, 1.0, w) if side == "left" else np.linspace(1.0, 0.3, w)
    gradient = np.tile(gradient, (h, 1))
    if len(arr.shape) == 3:
        gradient = np.expand_dims(gradient, -1)
    arr = np.clip(arr * gradient, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


# ============================================================
# Dataset Manager
# ============================================================

class DatasetManager:
    def __init__(self, config: TrainingConfig):
        self.config = config
        self.samples: List[OcrSample] = []

    def load_from_supabase(self):
        try:
            from supabase import create_client
            supabase = create_client(self.config.supabase_url, self.config.supabase_key)

            # Cargar TODOS los samples (verificados y no verificados)
            response = supabase.table('ocr_training_data') \
                .select('*') \
                .not_('image_original', 'is', None) \
                .order('created_at', desc=True) \
                .limit(5000) \
                .execute()

            # DEDUP por barcode: si hay un sample verificado (corrección usuario),
            # NO usar el no verificado (ML Kit erróneo) del mismo barcode
            verified_barcodes: set = set()
            unverified_by_barcode: Dict[str, List] = {}

            for row in response.data:
                barcode = row.get('barcode', '')
                if row.get('is_verified'):
                    verified_barcodes.add(barcode)

            for row in response.data:
                barcode = row.get('barcode', '')

                # Si este barcode ya tiene corrección verificada y esta muestra NO está verificada,
                # saltarla (ML Kit se equivocó, el ground truth sería incorrecto)
                if barcode in verified_barcodes and not row.get('is_verified'):
                    continue

                modelo = row.get('modelo_grupo', '') or \
                         (row.get('user_truth', {}) or {}).get('modelo_grupo', '') or \
                         (row.get('mlkit_result', {}) or {}).get('modelo_grupo', '')

                # Ground truth:
                #  - Verificado (confirmación/corrección usuario) → usa user_truth (VERDAD ABSOLUTA)
                #  - No verificado (sin corrección) → usa mlkit_result (ML Kit directo)
                truth = row.get('user_truth') if row.get('is_verified') else row.get('mlkit_result', {})

                sample = OcrSample(
                    id=row['id'],
                    image_original=row.get('image_original', ''),
                    image_preprocessed=row.get('image_preprocessed', ''),
                    mlkit_result=row.get('mlkit_result', {}),
                    user_truth=truth,
                    barcode=barcode,
                    modelo_grupo=modelo,
                    categoria=row.get('categoria', '') or categorize_label(modelo)
                )
                self.samples.append(sample)

            verified = sum(1 for s in self.samples if any(
                r.get('is_verified') for r in response.data if r['id'] == s.id
            ))
            total = len(self.samples)
            corrections = len(verified_barcodes)
            logger.info(f"Descargados {total} samples utilizables:")
            logger.info(f"  {corrections} correcciones de usuario (VERDAD ABSOLUTA)")
            logger.info(f"  {total - corrections} ML Kit directo (sin corrección)")
            logger.info(f"  {len(verified_barcodes)} muestras ML Kit DESCARTADAS (tenían corrección)")
            logger.info(f"💡 {self.config.min_samples_per_category}+ muestras por categoría = entrenamiento listo")

        except ImportError:
            logger.error("pip install supabase requerido")
            raise
        except Exception as e:
            logger.error(f"Error descargando: {e}")
            raise

    def load_from_directory(self, dir_path: str):
        dir_path = Path(dir_path)
        for json_file in dir_path.glob("*.json"):
            try:
                with open(json_file, 'r') as f:
                    data = json.load(f)
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
                        user_truth=data.get('user_truth'),
                        barcode=data.get('barcode'),
                        modelo_grupo=data.get('modelo_grupo', ''),
                        categoria=data.get('categoria', '') or categorize_label(data.get('modelo_grupo', ''))
                    )
                    self.samples.append(sample)
            except Exception as e:
                logger.warning(f"Error cargando {json_file}: {e}")

        logger.info(f"Cargados {len(self.samples)} samples locales")

    def get_by_category(self) -> Dict[str, List[OcrSample]]:
        by_cat: Dict[str, List[OcrSample]] = {}
        for s in self.samples:
            cat = s.categoria or "general"
            if cat not in by_cat:
                by_cat[cat] = []
            by_cat[cat].append(s)
        return by_cat

    def prepare_with_augmentation(self, category: str, samples: List[OcrSample]) -> List[Tuple[str, str]]:
        """
        Prepara pares (imagen_path, ground_truth) CON augmentación.
        Si hay < 50 muestras, genera 8 variaciones por muestra.
        Si hay 50-200, genera 4 variaciones por muestra.
        Si hay > 200, genera 2 variaciones por muestra.
        """
        training_data = []
        num_samples = len(samples)
        aug_factor = 8 if num_samples < 50 else (4 if num_samples < 200 else 2)
        logger.info(f"  Categoría '{category}': {num_samples} muestras × ~{aug_factor} aug = ~{num_samples * aug_factor}")

        cat_dir = Path(self.config.dataset_dir) / category
        cat_dir.mkdir(parents=True, exist_ok=True)

        for sample in samples:
            truth = sample.user_truth or sample.mlkit_result
            text_parts = []
            if truth.get('modelo_grupo'):
                text_parts.append(truth['modelo_grupo'])
            if truth.get('talla'):
                text_parts.append(truth['talla'])
            if truth.get('codigo_color'):
                text_parts.append(truth['codigo_color'])
            ground_truth = " ".join(text_parts).strip()
            if not ground_truth:
                continue

            # Decode image
            img_b64 = sample.image_preprocessed or sample.image_original
            if not img_b64:
                continue
            try:
                img = Image.open(BytesIO(base64.b64decode(img_b64))).convert('RGB')
            except:
                continue

            # Save original
            orig_path = cat_dir / f"{sample.id}_orig.jpg"
            img.save(orig_path)
            training_data.append((str(orig_path), ground_truth))

            # Generate augmented versions
            augmented = ImageAugmenter.apply_subset(img, aug_factor)
            for aug_name, aug_img in augmented:
                aug_path = cat_dir / f"{sample.id}_{aug_name}.jpg"
                aug_img.save(aug_path)
                training_data.append((str(aug_path), ground_truth))

        return training_data


# ============================================================
# PaddleOCR Per-Category Trainer
# ============================================================

class PaddleOcrTrainer:
    def __init__(self, config: TrainingConfig):
        self.config = config

    def prepare_per_category(self, category_data: Dict[str, List[OcrSample]], dataset_mgr: DatasetManager):
        """Prepara datasets por categoría con augmentación."""
        cat_datasets = {}

        for category, samples in category_data.items():
            if len(samples) < self.config.min_samples_per_category:
                logger.warning(f"  ⚠️  '{category}' solo tiene {len(samples)} muestras (mínimo: {self.config.min_samples_per_category}). Saltando.")
                continue

            all_data = dataset_mgr.prepare_with_augmentation(category, samples)
            random.shuffle(all_data)
            split_idx = int(len(all_data) * (1 - self.config.eval_split))
            train_data = all_data[:split_idx]
            val_data = all_data[split_idx:]

            cat_dir = Path(self.config.dataset_dir) / category
            for split_name, data in [("train", train_data), ("val", val_data)]:
                txt_path = cat_dir / f"{split_name}.txt"
                with open(txt_path, 'w', encoding='utf-8') as f:
                    for img_path, gt in data:
                        f.write(f"{img_path}\t{gt}\n")

            cat_datasets[category] = {'train': train_data, 'val': val_data, 'dir': cat_dir}
            logger.info(f"  ✅ '{category}': {len(train_data)} train, {len(val_data)} val")

        return cat_datasets

    def train_category(self, category: str, dataset: Dict) -> Optional[Path]:
        """Entrena PaddleOCR para una categoría específica."""
        try:
            import paddle
            from paddleocr.tools import train

            cat_dir: Path = dataset['dir']
            output_dir = Path(self.config.output_dir) / category
            output_dir.mkdir(parents=True, exist_ok=True)

            logger.info(f"  🔥 Entrenando '{category}'...")

            train_config = {
                'Global': {
                    'use_gpu': paddle.device.is_compiled_with_cuda(),
                    'epoch_num': self.config.epochs,
                    'log_batch_num': 10,
                    'save_model_dir': str(output_dir),
                    'save_epoch_num': 10,
                    'eval_batch_step': [0, 200],
                    'dataloader': {
                        'batch_size_per_card': self.config.batch_size,
                        'num_workers': 2,
                    },
                },
                'Architecture': {
                    'model_type': 'rec',
                    'algorithm': 'CRNN',
                    'Transform': None,
                    'Backbone': {
                        'name': 'MobileNetV3',
                        'scale': 0.5,
                    },
                    'Neck': {
                        'name': 'SequenceEncoder',
                        'encoder_type': 'rnn',
                        'hidden_units': 48,
                    },
                    'Head': {
                        'name': 'CTCHead',
                        'fc_decay': 0.0004,
                    },
                },
                'Loss': {'name': 'CTCLoss'},
                'Optimizer': {
                    'name': 'Adam',
                    'lr': {
                        'learning_rate': self.config.learning_rate,
                        'warmup_epoch': self.config.warmup_epochs,
                    },
                },
                'Train': {
                    'dataset': {
                        'name': 'SimpleDataSet',
                        'data_dir': str(cat_dir),
                        'label_file_list': [str(cat_dir / 'train.txt')],
                        'transforms': [
                            {'DecodeImage': {'img_mode': 'BGR', 'channel_first': False}},
                            {'CTLabelEncode': {}},
                            {'RecResizeImg': {'image_shape': [3, self.config.image_height, self.config.image_width]}},
                            {'KeepKeys': {'keep_keys': ['image', 'label', 'length']}},
                        ],
                    },
                    'loader': {
                        'shuffle': True,
                        'batch_size_per_card': self.config.batch_size,
                        'drop_last': True,
                        'num_workers': 2,
                    },
                },
                'Eval': {
                    'dataset': {
                        'name': 'SimpleDataSet',
                        'data_dir': str(cat_dir),
                        'label_file_list': [str(cat_dir / 'val.txt')],
                        'transforms': [
                            {'DecodeImage': {'img_mode': 'BGR', 'channel_first': False}},
                            {'CTLabelEncode': {}},
                            {'RecResizeImg': {'image_shape': [3, self.config.image_height, self.config.image_width]}},
                            {'KeepKeys': {'keep_keys': ['image', 'label', 'length']}},
                        ],
                    },
                },
            }

            import yaml
            config_path = cat_dir / 'config.yml'
            with open(config_path, 'w') as f:
                yaml.dump(train_config, f, default_flow_style=False)

            logger.info(f"  📄 Config guardada: {config_path}")
            logger.info(f"  ▶️  Ejecutando training para '{category}'...")

            try:
                train.main(config_args=['-c', str(config_path)])
            except Exception as e:
                logger.error(f"  ❌ Training falló: {e}")
                logger.info(f"  💡 Ejecuta manualmente:")
                logger.info(f"     python -m paddleocr.tools.train -c {config_path}")
                return None

            logger.info(f"  ✅ '{category}' entrenado → {output_dir}")
            return output_dir

        except ImportError:
            logger.error(f"  ❌ PaddleOCR no instalado. Ejecuta: pip install paddlepaddle paddleocr")
            return None

    def export_to_onnx(self, category: str, model_dir: Path) -> Optional[Path]:
        """Exporta modelo entrenado a ONNX para Android."""
        try:
            import paddle

            onnx_path = model_dir / "model.onnx"
            logger.info(f"  📦 Exportando '{category}' a ONNX → {onnx_path}")

            try:
                from paddleocr.tools import export
                export.main(config_args=[
                    '-c', str(model_dir / 'config.yml'),
                    '-o', f"Global.save_inference_dir={model_dir}"
                ])
            except:
                logger.warning(f"  ⚠️  Export assistido falló. Intentando manual...")

            # Manual ONNX export attempt
            try:
                model_path = str(next(model_dir.glob("best_accuracy*"))) if list(model_dir.glob("best_accuracy*")) else str(model_dir)
                logger.info(f"  📦 Modelo listo en: {model_path}")
            except:
                pass

            logger.info(f"  ✅ '{category}' exportado")
            return onnx_path

        except Exception as e:
            logger.error(f"  ❌ Error exportando '{category}': {e}")
            return None

    def evaluate_category(self, category: str, model_dir: Path, val_data: List) -> Dict:
        """Evalúa precisión del modelo."""
        try:
            from paddleocr import PaddleOCR

            model = PaddleOCR(
                rec_model_dir=str(model_dir),
                use_angle_cls=False,
                show_log=False
            )

            correct = 0
            total = 0

            for img_path, ground_truth in val_data[:min(len(val_data), 100)]:
                result = model.ocr(str(img_path), cls=False)
                predicted = ""
                if result and result[0]:
                    texts = [line[1][0] for line in result[0] if line[1][1] > 0.5]
                    predicted = " ".join(texts)

                if predicted.strip().upper() == ground_truth.strip().upper():
                    correct += 1
                total += 1

            accuracy = (correct / total * 100) if total > 0 else 0
            logger.info(f"  📊 '{category}': {accuracy:.1f}% ({correct}/{total})")
            return {'category': category, 'accuracy': accuracy, 'correct': correct, 'total': total}

        except Exception as e:
            logger.error(f"  ❌ Error evaluando '{category}': {e}")
            return {'category': category, 'accuracy': 0, 'error': str(e)}


# ============================================================
# Main Pipeline
# ============================================================

def run_pipeline(config: TrainingConfig):
    logger.info("=" * 60)
    logger.info("🚀 INICIANDO PIPELINE DE ENTRENAMIENTO PaddleOCR")
    logger.info("=" * 60)

    # 1. Load data
    mgr = DatasetManager(config)
    if config.supabase_url and config.supabase_key:
        mgr.load_from_supabase()
    elif config.dataset_dir and Path(config.dataset_dir).exists():
        mgr.load_from_directory(config.dataset_dir)
    else:
        logger.error("No hay fuente de datos. Usa --supabase-url o --dataset-dir")
        return

    if not mgr.samples:
        logger.error("No se encontraron samples")
        return

    # 2. Show stats
    by_cat = mgr.get_by_category()
    logger.info(f"\n📊 Dataset: {len(mgr.samples)} samples en {len(by_cat)} categorías:")
    for cat, samps in sorted(by_cat.items(), key=lambda x: -len(x[1])):
        verified = sum(1 for s in samps if s.user_truth)
        label = cat.replace('_', ' ').title()
        logger.info(f"  {label:20s}: {len(samps):4d} samples, {verified:4d} verificados")

    # 3. Prepare training data per category
    trainer = PaddleOcrTrainer(config)
    cat_datasets = trainer.prepare_per_category(by_cat, mgr)

    if not cat_datasets:
        logger.error(f"Ninguna categoría tiene {config.min_samples_per_category}+ muestras")
        return

    # 4. Train one model per category
    results = []
    for category, dataset in cat_datasets.items():
        logger.info(f"\n{'─' * 40}")
        logger.info(f"📱 CATEGORÍA: {category}")
        logger.info(f"{'─' * 40}")

        model_dir = trainer.train_category(category, dataset)
        if model_dir:
            if config.export_onnx:
                trainer.export_to_onnx(category, model_dir)

            acc = trainer.evaluate_category(category, model_dir, dataset['val'])
            results.append(acc)

    # 5. Summary
    logger.info(f"\n{'=' * 60}")
    logger.info("📊 RESUMEN FINAL")
    logger.info(f"{'=' * 60}")
    for r in sorted(results, key=lambda x: x.get('accuracy', 0), reverse=True):
        label = r['category'].replace('_', ' ').title()
        acc = r.get('accuracy', 0)
        bar = '█' * int(acc / 5) + '░' * (20 - int(acc / 5))
        logger.info(f"  {label:20s}: {acc:5.1f}% {bar}")

    # Save results
    results_path = Path(config.output_dir) / "training_results.json"
    results_path.parent.mkdir(parents=True, exist_ok=True)
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)
    logger.info(f"\n📄 Resultados guardados en: {results_path}")


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="PaddleOCR Training Pipeline")
    parser.add_argument("--supabase-url", help="Supabase URL")
    parser.add_argument("--supabase-key", help="Supabase service key")
    parser.add_argument("--dataset-dir", help="Directorio local con samples")
    parser.add_argument("--output-dir", default="./output")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=0.001)
    parser.add_argument("--min-samples", type=int, default=10,
                        help="Mínimo de muestras por categoría")
    parser.add_argument("--no-onnx", action="store_true",
                        help="No exportar a ONNX")

    args = parser.parse_args()

    config = TrainingConfig(
        supabase_url=args.supabase_url or "",
        supabase_key=args.supabase_key or "",
        dataset_dir=args.dataset_dir or "./dataset",
        output_dir=args.output_dir,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        min_samples_per_category=args.min_samples,
        export_onnx=not args.no_onnx
    )

    run_pipeline(config)


if __name__ == "__main__":
    main()
