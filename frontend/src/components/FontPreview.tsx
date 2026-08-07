import React, { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Download, Trash2 } from 'lucide-react'
import type { Font, CJKInfo, SubFont } from '@/lib/api'
import {
  fetchCJKInfo,
  fetchSubFonts,
  getFontFileUrl,
  deleteFont,
  restoreFont,
  formatFileSize,
} from '@/lib/api'

interface FontPreviewProps {
  font: Font | null
  open: boolean
  onClose: () => void
  onDelete: (fontId: number) => void
}

export function FontPreview({ font, open, onClose, onDelete }: FontPreviewProps) {
  const [cjkInfo, setCjkInfo] = useState<CJKInfo | null>(null)
  const [subfonts, setSubfonts] = useState<SubFont[]>([])
  const [selectedSubfont, setSelectedSubfont] = useState<number | undefined>(undefined)
  const [previewText, setPreviewText] = useState('字体预览 FontPreview 123')
  const [fontSize, setFontSize] = useState(36)
  const styleRef = useRef<HTMLStyleElement | null>(null)

  useEffect(() => {
    if (!font || !open) {
      setCjkInfo(null)
      setSubfonts([])
      setSelectedSubfont(undefined)
      return
    }

    // Fetch CJK info
    fetchCJKInfo(font.id).then(setCjkInfo).catch(console.error)

    // Fetch subfonts if TTC
    if (font.format === 'ttc') {
      fetchSubFonts(font.id).then((subs) => {
        setSubfonts(subs)
        if (subs.length > 0) setSelectedSubfont(subs[0].index)
      }).catch(console.error)
    } else {
      setSubfonts([])
      setSelectedSubfont(undefined)
    }
  }, [font, open])

  useEffect(() => {
    if (!font || !open) return

    // Load font face
    const url = getFontFileUrl(font.id, { subfont: selectedSubfont })
    const faceName = `PreviewFont_${font.id}_${selectedSubfont ?? 0}`

    // Remove old style
    if (styleRef.current) styleRef.current.remove()

    const style = document.createElement('style')
    // Determine font format for @font-face
    const formatMap: Record<string, string> = { ttf: 'truetype', otf: 'opentype', ttc: 'truetype' }
    const fontFormat = formatMap[font.format] || 'opentype'
    style.textContent = `@font-face { font-family: '${faceName}'; src: url('${url}') format('${fontFormat}'); }`
    document.head.appendChild(style)
    styleRef.current = style

    // Apply to preview area after a small delay to handle sheet animation
    const applyFont = () => {
      const previewArea = document.getElementById('preview-area')
      if (previewArea) {
        previewArea.style.fontFamily = `'${faceName}', sans-serif`
      }
    }
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      applyFont()
      // Also try again after a short delay in case of animation
      setTimeout(applyFont, 100)
    })

    return () => {
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
    }
  }, [font, open, selectedSubfont])

  const [showRestore, setShowRestore] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const konamiRef = useRef<number[]>([])
  const konamiCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65] // 上上下下左右左右BA

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      konamiRef.current.push(e.keyCode)
      if (konamiRef.current.length > konamiCode.length) {
        konamiRef.current.shift()
      }
      if (konamiRef.current.length === konamiCode.length && 
          konamiRef.current.every((code, i) => code === konamiCode[i])) {
        setShowDelete(true)
        konamiRef.current = []
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  const handleRestore = async () => {
    if (!font) return
    if (!confirm(`确定要还原 "${font.family_name} - ${font.style_name}" 到原始版本？`)) return
    try {
      const result = await restoreFont(font.id)
      alert(result.message)
      onClose()
      window.location.reload()
    } catch (err) {
      console.error('Restore failed:', err)
      alert('还原失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  if (!font) return null

  const handleDelete = async () => {
    if (!confirm(`确定要删除 "${font.family_name} - ${font.style_name}"？`)) return
    if (!confirm(`此操作不可撤销！再次确认删除 "${font.family_name} - ${font.style_name}"？`)) return
    try {
      await deleteFont(font.id)
      onDelete(font.id)
      onClose()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  // Group subfonts by region
  const regionLabels: Record<string, string> = {
    SC: '简体中文 (SC)',
    TC: '繁体中文 (TC)',
    HK: '香港繁体 (HK)',
    JP: '日文 (JP)',
    KR: '韩文 (KR)',
  }
  const regionOrder = ['SC', 'TC', 'HK', 'JP', 'KR']
  const groupedSubfonts: Record<string, SubFont[]> = {}
  subfonts.forEach((sf) => {
    const region = sf.region || 'Other'
    if (!groupedSubfonts[region]) groupedSubfonts[region] = []
    groupedSubfonts[region].push(sf)
  })

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{font.family_name}</DialogTitle>
          <DialogDescription>{font.style_name} · {font.format.toUpperCase()} · {formatFileSize(font.file_size)}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto py-4 space-y-4">
          {/* Subfont Selector */}
          {font.format === 'ttc' && subfonts.length > 0 && (
            <div className="space-y-2">
              <Label>子字体选择</Label>
              <Select
                value={selectedSubfont !== undefined ? String(selectedSubfont) : undefined}
                onValueChange={(v) => setSelectedSubfont(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择子字体" />
                </SelectTrigger>
                <SelectContent>
                  {regionOrder.map((region) => {
                    const subs = groupedSubfonts[region]
                    if (!subs || subs.length === 0) return null
                    return (
                      <React.Fragment key={region}>
                        <SelectItem value={`__region_${region}`} disabled>
                          {regionLabels[region] || region}
                        </SelectItem>
                        {subs.map((sf) => (
                          <SelectItem key={sf.index} value={String(sf.index)}>
                            {[sf.variant, sf.weight || sf.style_name || 'Regular'].filter(Boolean).join(' ')}
                          </SelectItem>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* CJK Info */}
          {cjkInfo && (
            <div className="space-y-2">
              <Label>中文支持</Label>
              <div className="flex flex-wrap gap-1">
                {cjkInfo.has_cjk ? (
                  <>
                    {cjkInfo.supports_sc && <Badge className="bg-green-100 text-green-800">简体中文</Badge>}
                    {cjkInfo.supports_tc && <Badge className="bg-blue-100 text-blue-800">繁体中文</Badge>}
                    {cjkInfo.supports_ja && <Badge className="bg-orange-100 text-orange-800">日文</Badge>}
                    {cjkInfo.supports_ko && <Badge className="bg-purple-100 text-purple-800">韩文</Badge>}
                  </>
                ) : (
                  <Badge variant="secondary">无中文支持</Badge>
                )}
              </div>
              {cjkInfo.warning && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 text-sm text-yellow-800">
                  ⚠️ {cjkInfo.warning}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Preview Controls */}
          <div className="space-y-2">
            <Label>预览文字</Label>
            <Input
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="输入预览文字..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>字号</Label>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">{fontSize}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={120}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Preview Area */}
          <div
            id="preview-area"
            className="border rounded-lg p-6 min-h-[120px] bg-[hsl(var(--muted))]/30 break-words"
            style={{ fontSize: `${fontSize}px`, lineHeight: 1.4 }}
          >
            {previewText || '字体预览 FontPreview 123'}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button className="flex-1" asChild>
            <a href={getFontFileUrl(font.id, { download: true })}>
              <Download className="h-4 w-4 mr-2" />
              下载
            </a>
          </Button>
          {showDelete && (
            <Button variant="destructive" className="flex-1" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              删除
            </Button>
          )}
        </div>
        
        {/* Hidden restore button - double-click title to reveal */}
        <div 
          className="pt-2 text-center" 
          onDoubleClick={() => setShowRestore(!showRestore)}
          style={{ cursor: 'default', userSelect: 'none' }}
        >
          <span className="text-xs text-gray-400">双击此处显示还原选项</span>
        </div>
        {showRestore && (
          <div className="flex gap-2 pt-2">
            <Button 
              variant="outline" 
              className="flex-1" 
              onClick={handleRestore}
            >
              还原到原始版本
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
