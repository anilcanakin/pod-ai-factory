'use client';

import { useState, useCallback } from 'react';
import { Upload, X, FileImage } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileDropzoneProps {
    onFile: (file: File) => void;
    accept?: string;
    label?: string;
}

export function FileDropzone({ onFile, accept = '.csv', label = 'Drop file here or click to browse' }: FileDropzoneProps) {
    const [dragging, setDragging] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) { setFileName(file.name); onFile(file); }
    }, [onFile]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) { setFileName(file.name); onFile(file); }
    };

    return (
        <label
            className={cn(
                'relative flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-200',
                dragging
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-700 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'
            )}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <input type="file" accept={accept} onChange={handleChange} className="hidden" />
            {fileName ? (
                <div className="flex items-center gap-2 text-sm text-slate-300">
                    <FileImage className="w-4 h-4 text-blue-400" />
                    <span className="truncate max-w-[200px]">{fileName}</span>
                    <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setFileName(null); }}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            ) : (
                <>
                    <Upload className="w-6 h-6 text-slate-500 mb-2" />
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">{accept} supported</p>
                </>
            )}
        </label>
    );
}
