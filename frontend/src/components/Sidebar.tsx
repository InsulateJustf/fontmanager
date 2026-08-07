import React, { useState, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

import { Upload, FolderOpen, Tag, BarChart3, Package, X, Plus, Loader2 } from 'lucide-react'
import type { Font, Tag as TagType, UploadResult } from '@/lib/api'
import { uploadFiles, createTag, deleteTag, downloadAllFonts } from '@/lib/api'

interface SidebarProps {
  fonts: Font[]
  tags: TagType[]
  selectedTagId: number | null
  onTagSelect: (tagId: number | null) => void
  onUploadComplete: (results: UploadResult[]) => void
  onTagsChange: () => void
}

export function Sidebar({
  fonts,
  tags,
  selectedTagId,
  onTagSelect,
  onUploadComplete,
  onTagsChange,
}: SidebarProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [folderInputKey, setFolderInputKey] = useState(0)
  const [newTagName, setNewTagName] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  // Recursively read all files from a directory entry
  const readDirectoryEntries = async (dirEntry: FileSystemDirectoryEntry): Promise<File[]> => {
    const reader = dirEntry.createReader()
    const allFiles: File[] = []
    
    // readEntries() returns partial results in Chrome; must loop until empty
    const readAllEntries = (): Promise<FileSystemEntry[]> => {
      return new Promise((resolve) => {
        const allEntries: FileSystemEntry[] = []
        const readBatch = () => {
          reader.readEntries(
            (entries) => {
              if (entries.length === 0) {
                resolve(allEntries)
              } else {
                allEntries.push(...entries)
                readBatch()
              }
            },
            (err) => {
              console.error('readEntries error:', err)
              resolve(allEntries)
            }
          )
        }
        readBatch()
      })
    }
    
    const entries = await readAllEntries()
    console.log(`readDirectoryEntries: ${dirEntry.name} has ${entries.length} entries`)
    
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject)
        )
        allFiles.push(file)
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
        allFiles.push(...subFiles)
      }
    }
    console.log(`readDirectoryEntries: ${dirEntry.name} found ${allFiles.length} files total`)
    return allFiles
  }

  const filterFontFiles = (files: File[] | FileList): File[] => {
    const fontExts = ['.ttf', '.otf', '.ttc']
    const result: File[] = []
    const arr = Array.from(files)
    for (const file of arr) {
      if (fontExts.some(ext => file.name.toLowerCase().endsWith(ext))) {
        result.push(file)
      }
    }
    return result
  }

  const handleFolderSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fontFiles = filterFontFiles(files)
    if (fontFiles.length === 0) {
      alert('未找到字体文件（TTF/OTF/TTC）')
      return
    }
    console.log('handleFolderSelect: adding', fontFiles.length, 'files to pending')
    setPendingFiles(prev => [...prev, ...fontFiles])
    setFolderInputKey(prev => prev + 1)
  }

  const handlePendingUpload = async () => {
    if (pendingFiles.length === 0) return
    setIsUploading(true)
    try {
      const dt = new DataTransfer()
      pendingFiles.forEach(f => dt.items.add(f))
      const results = await uploadFiles(dt.files)
      onUploadComplete(results)
      setPendingFiles([])
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    console.log('handleDrop called')
    const items = e.dataTransfer.items
    console.log('items length:', items?.length)

    // Collect all files from dropped items (files and directories)
    const allFiles: File[] = []
    
    if (items) {
      // Convert DataTransferItemList to array to avoid issues with async iteration
      const itemsArray = Array.from(items)
      console.log('Starting to process', itemsArray.length, 'items')
      for (let i = 0; i < itemsArray.length; i++) {
        console.log(`Processing item ${i} of ${itemsArray.length}`)
        try {
          const entry = itemsArray[i].webkitGetAsEntry?.()
          console.log(`item ${i}:`, entry?.name, 'isFile:', entry?.isFile, 'isDirectory:', entry?.isDirectory)
          if (!entry) {
            console.log(`item ${i}: entry is null, skipping`)
            continue
          }
          if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) =>
              (entry as FileSystemFileEntry).file(resolve, reject)
            )
            allFiles.push(file)
            console.log(`item ${i}: added file`, file.name)
          } else if (entry.isDirectory) {
            console.log(`item ${i}: reading directory`, entry.name)
            const files = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
            console.log(`item ${i}: directory ${entry.name} found ${files.length} files`)
            allFiles.push(...files)
          }
        } catch (err) {
          console.error(`item ${i}: error processing`, err)
        }
        console.log(`Finished processing item ${i}`)
      }
    }

    // Fallback: if no files collected from entries, use dataTransfer.files
    if (allFiles.length === 0 && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        allFiles.push(e.dataTransfer.files[i])
      }
    }

    console.log('total files collected:', allFiles.length)
    if (allFiles.length > 0) {
      await handleUpload(allFiles)
    }
  }

  const handleUpload = async (files: FileList | File[] | File[]) => {
    setIsUploading(true)
    try {
      const fontFiles = filterFontFiles(files)
      console.log('handleUpload: filtered', fontFiles.length, 'font files')
      if (fontFiles.length === 0) {
        alert('未找到字体文件（TTF/OTF/TTC）')
        return
      }
      const dt = new DataTransfer()
      fontFiles.forEach(f => dt.items.add(f))
      const results = await uploadFiles(dt.files)
      onUploadComplete(results)
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setIsUploading(false)
    }
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    try {
      await createTag(newTagName.trim(), '#6b7280')
      setNewTagName('')
      setShowTagInput(false)
      onTagsChange()
    } catch (err) {
      console.error('Failed to create tag:', err)
    }
  }

  const handleDeleteTag = async (tagId: number) => {
    try {
      await deleteTag(tagId)
      onTagsChange()
    } catch (err) {
      console.error('Failed to delete tag:', err)
    }
  }

  // Compute stats
  const stats = {
    total: fonts.length,
    ttc: fonts.filter(f => f.format === 'ttc').length,
    otf: fonts.filter(f => f.format === 'otf').length,
    ttf: fonts.filter(f => f.format === 'ttf').length,
  }

  return (
    <>
      <aside className="w-64 border-r bg-[hsl(var(--card))] flex flex-col h-full">
        {/* Upload Area */}
        <div className="p-4">
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
              isDragOver
                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10'
                : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mx-auto h-8 w-8 text-[hsl(var(--muted-foreground))]" />
            <p className="mt-2 text-sm font-medium">
              {isUploading ? '上传中...' : '拖拽上传字体'}
            </p>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              支持 TTF、OTF、TTC
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              <Upload className="h-4 w-4 mr-1" />
              文件
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => folderInputRef.current?.click()}
              disabled={isUploading}
              title="按住 Ctrl/Cmd 可多选文件夹，或多次选择累加"
            >
              <FolderOpen className="h-4 w-4 mr-1" />
              文件夹
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".ttf,.otf,.ttc"
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          <input
            key={folderInputKey}
            ref={folderInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={(e) => handleFolderSelect(e.target.files)}
          />
        </div>

        {pendingFiles.length > 0 && (
          <div className="px-4 pb-2">
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm">
              <p className="text-blue-800 mb-2">
                已选择 {pendingFiles.length} 个字体文件
              </p>
              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  className="flex-1"
                  onClick={handlePendingUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4 mr-1" />
                  )}
                  上传
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => setPendingFiles([])}
                  disabled={isUploading}
                >
                  清空
                </Button>
              </div>
              <Button 
                size="sm" 
                variant="ghost"
                className="w-full mt-2"
                onClick={() => folderInputRef.current?.click()}
                disabled={isUploading}
              >
                <FolderOpen className="h-4 w-4 mr-1" />
                继续选择文件夹
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Tags */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold flex items-center gap-1">
              <Tag className="h-4 w-4" />
              标签
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowTagInput(!showTagInput)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {showTagInput && (
            <div className="flex gap-1 mb-2">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="标签名称"
                className="h-8 text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <Button size="sm" className="h-8 px-2" onClick={handleCreateTag}>
                添加
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            <Badge
              variant={selectedTagId === null ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => onTagSelect(null)}
            >
              全部
            </Badge>
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={selectedTagId === tag.id ? 'default' : 'outline'}
                className="cursor-pointer group"
                onClick={() => onTagSelect(tag.id)}
              >
                {tag.name}
                <span className="ml-1 text-xs opacity-60">{tag.count}</span>
                <button
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteTag(tag.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Statistics */}
        <div className="p-4 flex-1">
          <h3 className="text-sm font-semibold flex items-center gap-1 mb-3">
            <BarChart3 className="h-4 w-4" />
            统计
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">总字体数</span>
              <span className="font-medium">{stats.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">TTC</span>
              <span className="font-medium">{stats.ttc}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">OTF</span>
              <span className="font-medium">{stats.otf}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">TTF</span>
              <span className="font-medium">{stats.ttf}</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Download All */}
        <div className="p-4">
          <Button className="w-full" onClick={downloadAllFonts}>
            <Package className="h-4 w-4 mr-2" />
            打包下载全部
          </Button>
        </div>
      </aside>

      {/* Upload Progress Dialog */}
      <Dialog open={isUploading} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              上传中
            </DialogTitle>
            <DialogDescription>
              正在上传字体文件，请稍候...
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
