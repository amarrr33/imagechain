import { sha256 } from './cryptoService';
import type { Snapshot } from '../types';

export interface NormalizedImage {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  hashPromise: Promise<string>;
}

export interface RenderResult extends NormalizedImage {
  image: HTMLImageElement;
}

export interface TransformDownloadOptions {
  rotationDegrees?: number;
  embedCallback?: (canvas: HTMLCanvasElement, payload?: Uint8Array | string | null) => Promise<void> | void;
  payload?: Uint8Array | string | null;
  fileName?: string;
  mimeType?: string;
}

const createCanvas = (width: number, height: number): NormalizedImage => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Unable to acquire 2D context.');
  }
  context.imageSmoothingQuality = 'high';
  context.imageSmoothingEnabled = true;

  const hashPromise = new Promise<string>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      try {
        if (!blob) {
          reject(new Error('Failed to generate blob for hashing.'));
          return;
        }
        const buffer = await blob.arrayBuffer();
        resolve(await sha256(buffer));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 'image/png');
  });

  return { canvas, context, hashPromise };
};

export const loadImage = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read file.'));
    reader.onload = () => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load.'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
};

export const normalizeImage = (image: HTMLImageElement): NormalizedImage => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) {
    throw new Error('Image has invalid dimensions.');
  }

  const normalized = createCanvas(width, height);
  normalized.context.clearRect(0, 0, width, height);
  normalized.context.drawImage(image, 0, 0, width, height);
  return normalized;
};

export const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string = 'image/png',
  quality?: number,
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to convert canvas to Blob.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
};

export const createSnapshot = async (
  canvas: HTMLCanvasElement,
  width = 160,
): Promise<Snapshot> => {
  const aspectRatio = canvas.height === 0 ? 1 : canvas.width / canvas.height;
  const snapshotWidth = Math.max(1, Math.round(width));
  const snapshotHeight = Math.max(1, Math.round(snapshotWidth / aspectRatio));

  const { canvas: snapshotCanvas, context } = createCanvas(snapshotWidth, snapshotHeight);
  context.drawImage(canvas, 0, 0, snapshotWidth, snapshotHeight);

  const blob = await canvasToBlob(snapshotCanvas, 'image/webp', 0.8);
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected snapshot encoding.'));
        return;
      }
      const [, data] = result.split(',');
      if (!data) {
        reject(new Error('Snapshot conversion failed.'));
        return;
      }
      resolve(data);
    };
    reader.onerror = () => reject(new Error('Snapshot read failed.'));
    reader.readAsDataURL(blob);
  });

  return {
    w: snapshotWidth,
    h: snapshotHeight,
    codec: 'webp',
    bytes_b64: base64,
  };
};

const waitForImage = async (image: HTMLImageElement): Promise<void> => {
  if (image.complete && image.naturalWidth > 0) {
    return;
  }
  if ('decode' in image && typeof image.decode === 'function') {
    await image.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Image failed to load.'));
  });
};

export const renderCanvasFromImage = async (
  source: File | HTMLImageElement,
): Promise<RenderResult> => {
  const image = source instanceof File ? await loadImage(source) : source;
  await waitForImage(image);
  const normalized = normalizeImage(image);
  return {
    image,
    canvas: normalized.canvas,
    context: normalized.context,
    hashPromise: normalized.hashPromise,
  };
};

const drawWithRotation = (
  source: HTMLCanvasElement | HTMLImageElement,
  rotationDegrees = 0,
): HTMLCanvasElement => {
  const radians = ((rotationDegrees % 360) * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));

  const width = source instanceof HTMLImageElement
    ? source.naturalWidth || source.width
    : source.width;
  const height = source instanceof HTMLImageElement
    ? source.naturalHeight || source.height
    : source.height;

  const rotatedWidth = Math.max(1, Math.round(width * cos + height * sin));
  const rotatedHeight = Math.max(1, Math.round(width * sin + height * cos));
  const { canvas, context } = createCanvas(rotatedWidth, rotatedHeight);

  context.save();
  context.translate(rotatedWidth / 2, rotatedHeight / 2);
  context.rotate(radians);
  context.drawImage(source, -width / 2, -height / 2);
  context.restore();

  return canvas;
};

export const transformAndDownload = async (
  source: HTMLCanvasElement | HTMLImageElement,
  options: TransformDownloadOptions = {},
): Promise<void> => {
  const {
    rotationDegrees = 0,
    embedCallback,
    payload = null,
    fileName = 'imagechain.png',
    mimeType = 'image/png',
  } = options;

  const rotatedCanvas = rotationDegrees
    ? drawWithRotation(source, rotationDegrees)
    : source instanceof HTMLCanvasElement
      ? source
      : normalizeImage(source).canvas;

  if (embedCallback) {
    await embedCallback(rotatedCanvas, payload);
  }

  const blob = await canvasToBlob(rotatedCanvas, mimeType);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
};
