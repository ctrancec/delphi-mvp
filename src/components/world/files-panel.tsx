"use client"

import React, { useRef } from 'react'
import { Upload, FileText, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorldState } from '@/lib/world/types'
import type { StorageStatus } from '@/lib/world/client'

interface Props {
    state: WorldState
    companyId: string | null
    storage: StorageStatus[]
    onUpload: (file: File) => void
}

export function FilesPanel({ state, companyId, storage, onUpload }: Props) {
    const picker = useRef<HTMLInputElement | null>(null)
    const files = state.files.filter((f) => f.companyId === companyId)
    const active = storage.find((s) => s.id === state.settings.storageProvider)

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Drive</p>
                    <p className="text-[11px] text-muted-foreground">
                        {active?.label ?? state.settings.storageProvider}
                        {active && !active.configured ? ' (not configured — using local disk)' : ''}
                    </p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => picker.current?.click()}>
                    <Upload className="mr-1 h-3.5 w-3.5" /> Upload
                </Button>
                <input
                    ref={picker}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) onUpload(file)
                        e.target.value = ''
                    }}
                />
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto p-3">
                {files.length === 0 && (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        Nothing here yet. Upload a file and your team can read it.
                    </p>
                )}
                {files.map((file) => (
                    <div
                        key={file.id}
                        className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-2"
                    >
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs">{file.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                                {(file.size / 1024).toFixed(1)} KB · {file.provider}
                            </p>
                        </div>
                        <a
                            href={file.url ?? `/api/world/files?fileId=${file.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                            <Download className="h-3.5 w-3.5" />
                        </a>
                    </div>
                ))}
            </div>
        </div>
    )
}
