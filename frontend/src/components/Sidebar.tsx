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

import { Upload, FolderOpen, Tag, BarChart3, Package, X, Plus, Loader2, Edit2, Palette } from 'lucide-react'
import type { Font, Tag as TagType, UploadResult } from '@/lib/api'
import { uploadFiles, createTag, deleteTag, updateTag, downloadAllFonts, fetchVersion } from '@/lib/api'

interface SidebarProps {
  fonts: Font[]
  tags: TagType[]
  selectedTagId: number | null
  onTagSelect: (tagId: number | null) => void
  onUploadComplete: (results: UploadResult[]) => void
  onTagsChange: () => void
}

// 预设颜色
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e'
]

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
  const [version, setVersion] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [folderInputKey, setFolderInputKey] = useState(0)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [showTagInput, setShowTagInput] = useState(false)
  const [editingTag, setEditingTag] = useState<TagType | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [editTagColor, setEditTagColor] = useState('')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  // Fetch version on mount
  React.useEffect(() => {
    fetchVersion().then(setVersion).catch(console.error)
  }, [])

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

  const handleFolderSelectComplete = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fontFiles = filterFontFiles(files)
    if (fontFiles.length === 0) {
      alert('未找到字体文件（TTF/OTF/TTC）')
      return
    }
    const newPendingCount = pendingFiles.length + fontFiles.length
    setPendingFiles(prev => [...prev, ...fontFiles])
    setFolderInputKey(prev => prev + 1)
    
    const continueSelect = confirm(`已选择 ${newPendingCount} 个字体文件。

是否继续选择更多文件夹？`)
    if (continueSelect) {
      setTimeout(() => folderInputRef.current?.click(), 100)
    }
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

    const items = e.dataTransfer.items
    const allFiles: File[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const entry = item.webkitGetAsEntry?.()
      if (entry) {
        if (entry.isDirectory) {
          const files = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
          allFiles.push(...files)
        } else if (entry.isFile) {
          const file = item.getAsFile()
          if (file) allFiles.push(file)
        }
      }
    }

    const fontFiles = filterFontFiles(allFiles)
    if (fontFiles.length === 0) {
      alert('未找到字体文件（TTF/OTF/TTC）')
      return
    }
    setPendingFiles(prev => [...prev, ...fontFiles])
  }

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return
    try {
      await createTag(newTagName.trim(), newTagColor)
      setNewTagName('')
      setNewTagColor(PRESET_COLORS[0])
      setShowTagInput(false)
      onTagsChange()
    } catch (err) {
      console.error('Failed to create tag:', err)
    }
  }

  const handleDeleteTag = async (tagId: number) => {
    if (!confirm('确定要删除此标签？')) return
    try {
      await deleteTag(tagId)
      onTagsChange()
    } catch (err) {
      console.error('Failed to delete tag:', err)
    }
  }

  const handleEditTag = (tag: TagType) => {
    setEditingTag(tag)
    setEditTagName(tag.name)
    setEditTagColor(tag.color || PRESET_COLORS[0])
    setShowColorPicker(false)
  }

  const handleSaveEditTag = async () => {
    if (!editingTag || !editTagName.trim()) return
    try {
      await updateTag(editingTag.id, { name: editTagName.trim(), color: editTagColor })
      setEditingTag(null)
      onTagsChange()
    } catch (err) {
      console.error('Failed to update tag:', err)
    }
  }

  const stats = {
    total: fonts.length,
  }

  return (
    <>
      <aside className="w-72 border-r bg-[hsl(var(--background))] flex flex-col overflow-hidden">
        {/* Upload Area */}
        <div
          className={`p-4 border-b transition-colors ${isDragOver ? 'bg-[hsl(var(--primary))]/10' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1">
            <Upload className="h-4 w-4" />
            上传字体
          </h3>
          {pendingFiles.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-3">
                拖拽字体文件或文件夹到此处
              </p>
              <div className="flex gap-2 justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  选择文件
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isUploading}
                >
                  选择文件夹
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".ttf,.otf,.ttc"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    const fontFiles = filterFontFiles(e.target.files)
                    setPendingFiles(prev => [...prev, ...fontFiles])
                  }
                }}
              />
              <input
                key={folderInputKey}
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                className="hidden"
                onChange={(e) => handleFolderSelectComplete(e.target.files)}
              />
            </div>
          ) : (
            <div>
              <p className="text-sm mb-2">
                已选择 <span className="font-medium">{pendingFiles.length}</span> 个字体文件
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handlePendingUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      上传中...
                    </>
                  ) : (
                    '开始上传'
                  )}
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
          )}
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
            <div className="mb-2 space-y-2">
              <div className="flex gap-1">
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
              <div className="flex items-center gap-1 flex-wrap">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${newTagColor === color ? 'border-gray-900 scale-110' : 'border-gray-200'}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewTagColor(color)}
                    title={color}
                  />
                ))}
              </div>
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
                style={{ 
                  backgroundColor: selectedTagId === tag.id ? tag.color : undefined,
                  borderColor: tag.color 
                }}
                onClick={() => onTagSelect(tag.id)}
              >
                {tag.name}
                <span className="ml-1 text-xs opacity-60">{tag.count}</span>
                <button
                  className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditTag(tag)
                  }}
                  title="编辑标签"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
                <button
                  className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteTag(tag.id)
                  }}
                  title="删除标签"
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
        {/* Version */}
        {version && (
          <div className="px-4 pb-2 text-center">
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              {version}
            </span>
          </div>
        )}
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

      {/* Edit Tag Dialog */}
      <Dialog open={!!editingTag} onOpenChange={() => setEditingTag(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
            <DialogDescription>
              修改标签名称和颜色
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">标签名称</label>
              <Input
                value={editTagName}
                onChange={(e) => setEditTagName(e.target.value)}
                placeholder="输入标签名称"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveEditTag()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">标签颜色</label>
              <div className="flex items-center gap-2">
                <div className="flex flex-wrap gap-1 flex-1">
                  {PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${editTagColor === color ? 'border-gray-900 scale-110' : 'border-gray-200'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setEditTagColor(color)}
                    />
                  ))}
                </div>
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowColorPicker(!showColorPicker)}
                  >
                    <Palette className="h-4 w-4" />
                  </Button>
                  {showColorPicker && (
                    <div className="absolute right-0 top-full mt-1 bg-white border rounded-md shadow-lg z-50 p-2">
                      <input
                        type="color"
                        value={editTagColor}
                        onChange={(e) => setEditTagColor(e.target.value)}
                        className="w-32 h-32 cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingTag(null)}>
                取消
              </Button>
              <Button onClick={handleSaveEditTag}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
