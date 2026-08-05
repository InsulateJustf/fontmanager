import React, { useState, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

import { Upload, FolderOpen, Tag, BarChart3, Package, X, Plus } from 'lucide-react'
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      await handleUpload(e.dataTransfer.files)
    }
  }

  const handleUpload = async (files: FileList) => {
    setIsUploading(true)
    try {
      // Filter font files (including from nested folders)
      const fontExts = ['.ttf', '.otf', '.ttc']
      const fontFiles: File[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const name = file.name.toLowerCase()
        if (fontExts.some(ext => name.endsWith(ext))) {
          fontFiles.push(file)
        }
      }
      if (fontFiles.length === 0) {
        alert('未找到字体文件（TTF/OTF/TTC）')
        return
      }
      // Create a DataTransfer to build a FileList
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
      if (selectedTagId === tagId) onTagSelect(null)
      onTagsChange()
    } catch (err) {
      console.error('Failed to delete tag:', err)
    }
  }

  // Statistics
  const stats = {
    total: fonts.length,
    ttc: fonts.filter(f => f.format === 'ttc').length,
    otf: fonts.filter(f => f.format === 'otf').length,
    ttf: fonts.filter(f => f.format === 'ttf').length,
  }

  return (
    <aside className="w-64 border-r bg-[hsl(var(--card))] flex flex-col h-screen">
      {/* Upload Area */}
      <div className="p-4">
        <div
          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
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
          ref={folderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
        />
      </div>

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
  )
}
