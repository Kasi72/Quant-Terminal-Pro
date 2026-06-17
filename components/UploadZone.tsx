'use client';

import { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, FileText, AlertCircle } from 'lucide-react';

interface Props {
  onSymbols: (symbols: string[]) => void;
  loading: boolean;
}

export default function UploadZone({ onSymbols, loading }: Props) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback((file: File) => {
    setError('');
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const col = result.meta.fields?.find((f) =>
          f.trim().toLowerCase() === 'symbol'
        );
        if (!col) {
          setError('CSV must have a column named "Symbol"');
          return;
        }
        const syms = result.data
          .map((r) => r[col]?.trim())
          .filter(Boolean) as string[];
        if (!syms.length) {
          setError('No symbols found in the CSV');
          return;
        }
        setPreview(syms);
      },
      error: () => setError('Failed to parse CSV'),
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) parseFile(file);
    },
    [parseFile]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleRun = () => {
    if (preview.length) onSymbols(preview);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !loading && inputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200
          ${dragging ? 'border-indigo-400 bg-indigo-950/40 scale-[1.01]' : 'border-slate-600 hover:border-indigo-500 hover:bg-slate-800/50'}
          ${loading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
        <Upload className="mx-auto mb-3 text-indigo-400" size={36} />
        <p className="text-slate-200 font-semibold text-lg">Drop your CSV here or click to browse</p>
        <p className="text-slate-400 text-sm mt-1">CSV must have a <span className="text-indigo-300 font-mono">Symbol</span> column</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/30 border border-red-800 rounded-xl px-4 py-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {preview.length > 0 && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-slate-200 font-medium">
              <FileText size={16} className="text-indigo-400" />
              {preview.length} symbols loaded
            </div>
            <button
              onClick={handleRun}
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
            >
              {loading ? 'Scanning…' : 'Run Screener →'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {preview.map((s) => (
              <span key={s} className="bg-slate-700 text-slate-200 text-xs font-mono px-2.5 py-1 rounded-lg">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
