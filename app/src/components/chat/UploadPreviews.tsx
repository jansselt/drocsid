import type { PendingUpload } from './hooks/useFileUpload';

interface UploadPreviewsProps {
  uploads: PendingUpload[];
  onRemove: (index: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPreviews({ uploads, onRemove }: UploadPreviewsProps) {
  if (uploads.length === 0) return null;

  return (
    <div className="upload-previews">
      {uploads.map((upload, i) => (
        <div key={i} className={`upload-preview ${upload.progress}`}>
          {upload.file.type.startsWith('image/') && (
            <img
              className="upload-thumb"
              src={URL.createObjectURL(upload.file)}
              alt=""
              onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
            />
          )}
          <span className="upload-name">{upload.name}</span>
          <span className="upload-size">{formatSize(upload.file.size)}</span>
          {upload.progress === 'pending' && (
            <button className="upload-remove" onClick={() => onRemove(i)}>x</button>
          )}
          {upload.progress === 'uploading' && (
            <span className="upload-status">Uploading...</span>
          )}
          {upload.progress === 'error' && (
            <span className="upload-status error">Failed</span>
          )}
        </div>
      ))}
    </div>
  );
}
