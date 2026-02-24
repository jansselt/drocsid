import { useState, useRef, useEffect, useCallback } from 'react';
import './ImageCropModal.css';

interface ImageCropModalProps {
  file: File;
  onSave: (croppedBlob: Blob) => void;
  onCancel: () => void;
  shape?: 'circle' | 'square';
}

const CROP_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.01;

export function ImageCropModal({ file, onSave, onCancel, shape = 'circle' }: ImageCropModalProps) {
  const [imgSrc, setImgSrc] = useState('');
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null);

  // Load the file into an object URL
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Get natural image dimensions once loaded
  const handleImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  // Compute the scaled image dimensions
  const scaledW = imgSize.w > 0 ? (imgSize.w / Math.min(imgSize.w, imgSize.h)) * CROP_SIZE * zoom : CROP_SIZE;
  const scaledH = imgSize.h > 0 ? (imgSize.h / Math.min(imgSize.w, imgSize.h)) * CROP_SIZE * zoom : CROP_SIZE;

  // Clamp offsets so the image can't be dragged outside the crop area
  const clamp = useCallback(
    (ox: number, oy: number) => {
      const maxX = Math.max(0, (scaledW - CROP_SIZE) / 2);
      const maxY = Math.max(0, (scaledH - CROP_SIZE) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, ox)),
        y: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [scaledW, scaledH],
  );

  // Re-clamp when zoom changes
  useEffect(() => {
    setOffset((prev) => clamp(prev.x, prev.y));
  }, [zoom, clamp]);

  // Mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOx: offset.x, startOy: offset.y };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setOffset(clamp(dragRef.current.startOx + dx, dragRef.current.startOy + dy));
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Scroll to zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z - e.deltaY * ZOOM_STEP)));
  };

  // Render crop to canvas and export
  const handleSave = async () => {
    const img = imgRef.current;
    if (!img || imgSize.w === 0) return;
    setSaving(true);

    const canvas = document.createElement('canvas');
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;
    const ctx = canvas.getContext('2d')!;

    // The visible portion: the image is centered in the crop area, shifted by offset and scaled
    // We need to compute which part of the source image maps to the visible crop area
    const scale = Math.min(imgSize.w, imgSize.h) / (CROP_SIZE * zoom);

    // Center of the source image
    const cx = imgSize.w / 2;
    const cy = imgSize.h / 2;

    // Source rect: the crop area in source-image coordinates
    const srcW = CROP_SIZE * scale;
    const srcH = CROP_SIZE * scale;
    const srcX = cx - srcW / 2 - offset.x * scale;
    const srcY = cy - srcH / 2 - offset.y * scale;

    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }

    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, CROP_SIZE, CROP_SIZE);

    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (blob) onSave(blob);
      },
      'image/png',
    );
  };

  return (
    <div className="crop-modal-overlay" onClick={onCancel}>
      <div className="crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crop-modal-header">
          <h3>Crop Image</h3>
          <button className="settings-close" onClick={onCancel}>&times;</button>
        </div>

        <div
          className="crop-viewport"
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        >
          {imgSrc && (
            <img
              ref={imgRef}
              src={imgSrc}
              alt=""
              className="crop-image"
              draggable={false}
              onLoad={handleImgLoad}
              style={{
                width: scaledW,
                height: scaledH,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <div className={`crop-mask ${shape === 'circle' ? 'crop-mask-circle' : 'crop-mask-square'}`} />
        </div>

        <div className="crop-controls">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="crop-zoom-icon">
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="crop-zoom-slider"
          />
          <span className="crop-zoom-label">{Math.round(zoom * 100)}%</span>
        </div>

        <div className="crop-actions">
          <button className="profile-reset-btn" onClick={onCancel}>Cancel</button>
          <button className="profile-save-btn" onClick={handleSave} disabled={saving || imgSize.w === 0}>
            {saving ? 'Saving...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
