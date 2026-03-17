import { useState, useRef, useCallback } from 'react';

export interface PendingUpload {
  file: File;
  name: string;
  progress: 'pending' | 'uploading' | 'done' | 'error';
}

export function useFileUpload() {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const addFiles = useCallback((files: FileList) => {
    const newUploads: PendingUpload[] = Array.from(files).map((file) => ({
      file,
      name: file.name,
      progress: 'pending' as const,
    }));
    setUploads((prev) => [...prev, ...newUploads]);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
      return;
    }
    // Fallback: webkit2gtk older versions return empty clipboardData.files
    // for pasted images. Use the async Clipboard API to read image blobs.
    if (navigator.clipboard?.read) {
      navigator.clipboard.read().then((items) => {
        const promises = items.map(async (item) => {
          const imageType = item.types.find((t) => t.startsWith('image/'));
          if (!imageType) return null;
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          return new File([blob], `pasted-image.${ext}`, { type: imageType });
        });
        return Promise.all(promises);
      }).then((results) => {
        const imageFiles = results.filter((f): f is File => f !== null);
        if (imageFiles.length > 0) {
          const dt = new DataTransfer();
          imageFiles.forEach((f) => dt.items.add(f));
          addFiles(dt.files);
        }
      }).catch(() => {
        // Clipboard API unavailable or denied — no-op
      });
    }
  }, [addFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const removeUpload = useCallback((index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    uploads,
    setUploads,
    isDragging,
    fileInputRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    handleFileSelect,
    removeUpload,
    openFilePicker,
  };
}
