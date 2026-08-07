import React, { useState, useRef, useEffect, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { Download, Trash2, Search, ArrowUpDown, Plus, X, ChevronDown, ChevronRight, Package, Check } from 'lucide-react'
import type { Font, CJKInfo, Tag as TagType } from '@/lib/api'
import { deleteFont, getFontFileUrl, formatFileSize, addTagToFont, removeTagFromFont, downloadFamilyFonts, downloadSelectedFonts, batchAddTagToFonts, batchRemoveTagFromFonts, createTag } from '@/lib/api'

interface FontTableProps {
  fonts: Font[]
  cjkInfoMap: Record<number, CJKInfo>
  tags: TagType[]
  fontTagsMap: Record<number, TagType[]>
  selectedTagId: number | null
  isAdmin: boolean
  onFontSelect: (font: Font) => void
  onDelete: (fontId: number) => void
  onTagsChange: () => void
}

type SortField = 'family_name' | 'format' | 'file_size'
type SortDirection = 'asc' | 'desc'

// 内联预览组件
function InlinePreview({ fontId, fontFormat }: { fontId: number; fontFormat: string }) {
  const [loaded, setLoaded] = useState(false)
  const faceName = `InlinePreview_${fontId}`

  useEffect(() => {
    const url = getFontFileUrl(fontId)
    const formatMap: Record<string, string> = { ttf: 'truetype', otf: 'opentype', ttc: 'truetype' }
    const fontFormatStr = formatMap[fontFormat] || 'opentype'
    
    const style = document.createElement('style')
    style.textContent = `@font-face { font-family: '${faceName}'; src: url('${url}') format('${fontFormatStr}'); }`
    document.head.appendChild(style)
    setLoaded(true)
    
    return () => {
      style.remove()
    }
  }, [fontId, fontFormat])

  return (
    <span 
      className="text-lg whitespace-nowrap overflow-hidden text-ellipsis"
      style={{ fontFamily: loaded ? `'${faceName}', sans-serif` : 'inherit' }}
    >
      预览 Preview 123
    </span>
  )
}

export function FontTable({
  fonts,
  cjkInfoMap,
  tags,
  fontTagsMap,
  selectedTagId,
  isAdmin,
  onFontSelect,
  onDelete,
  onTagsChange,
}: FontTableProps) {
  const [search, setSearch] = useState('')
  const [formatFilter, setFormatFilter] = useState<string>('all')
  const [langFilter, setLangFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('family_name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [tagFontId, setTagFontId] = useState<number | null>(null)
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const pageSize = 50
  const [showBatchTagSelect, setShowBatchTagSelect] = useState(false)
  const [batchTagMode, setBatchTagMode] = useState<'add' | 'remove'>('add')
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set())
  const batchTagRef = useRef<HTMLDivElement>(null)
  
  // 快速创建标签相关状态
  const [newTagName, setNewTagName] = useState('')

  const tagSelectRef = useRef<HTMLDivElement>(null)

  // 判断是否为中文字体
  const isChineseFont = (familyName: string) => /[\u4e00-\u9fff]/.test(familyName)

  // Filter
  const filtered = useMemo(() => {
    return fonts.filter((font) => {
      const matchesSearch =
        font.family_name.toLowerCase().includes(search.toLowerCase()) ||
        font.style_name.toLowerCase().includes(search.toLowerCase())
      const matchesFormat = formatFilter === 'all' || font.format === formatFilter
      const cjk = cjkInfoMap[font.id]
      let matchesLang = true
      if (langFilter !== 'all' && cjk) {
        switch (langFilter) {
          case 'sc': matchesLang = cjk.supports_sc; break
          case 'tc': matchesLang = cjk.supports_tc; break
          case 'ja': matchesLang = cjk.supports_ja; break
          case 'ko': matchesLang = cjk.supports_ko; break
          case 'none': matchesLang = !cjk.has_cjk; break
        }
      }
      // Tag filtering
      let matchesTag = true
      if (selectedTagId !== null) {
        const fontTags = fontTagsMap[font.id] || []
        matchesTag = fontTags.some(t => t.id === selectedTagId)
      }
      return matchesSearch && matchesFormat && matchesLang && matchesTag
    })
  }, [fonts, search, formatFilter, langFilter, selectedTagId, cjkInfoMap, fontTagsMap])

  // Sort - 先英后中
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // 先按语言分类：英文在前，中文在后
      const aIsChinese = isChineseFont(a.family_name)
      const bIsChinese = isChineseFont(b.family_name)
      
      if (aIsChinese !== bIsChinese) {
        return aIsChinese ? 1 : -1 // 英文在前
      }
      
      // 同一类别内按排序字段排序
      let cmp = 0
      switch (sortField) {
        case 'family_name':
          cmp = a.family_name.localeCompare(b.family_name)
          break
        case 'format':
          cmp = a.format.localeCompare(b.format)
          break
        case 'file_size':
          cmp = a.file_size - b.file_size
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortField, sortDirection])

  // Group sorted fonts by family_name for display
  const familyGroups = useMemo(() => {
    const groups: { family: string; fonts: Font[]; hasMultiple: boolean }[] = []
    const familyMap = new Map<string, Font[]>()
    for (const font of sorted) {
      const key = font.family_name
      if (!familyMap.has(key)) familyMap.set(key, [])
      familyMap.get(key)!.push(font)
    }
    for (const [family, groupFonts] of familyMap) {
      groups.push({ family, fonts: groupFonts, hasMultiple: groupFonts.length > 1 })
    }
    return groups
  }, [sorted])

  // 默认展开所有多字重家族
  useEffect(() => {
    const multiFamilies = familyGroups
      .filter(g => g.hasMultiple)
      .map(g => g.family)
    setExpandedFamilies(new Set(multiFamilies))
  }, [familyGroups])

  // Paginate at family group level
  const totalGroups = familyGroups.length
  const totalPages = Math.ceil(totalGroups / pageSize)
  const paginatedGroups = familyGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const toggleSelect = (fontId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(fontId)) next.delete(fontId)
      else next.add(fontId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (sorted.length > 0 && sorted.every(f => selectedIds.has(f.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sorted.map(f => f.id)))
    }
  }

  const toggleSelectFamily = (fonts: Font[]) => {
    const allSelected = fonts.every(f => selectedIds.has(f.id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      fonts.forEach(f => {
        if (allSelected) next.delete(f.id)
        else next.add(f.id)
      })
      return next
    })
  }

  const handleBatchAddTag = async () => {
    if (selectedIds.size === 0 || selectedTagIds.size === 0) return
    try {
      for (const tagId of selectedTagIds) {
        await batchAddTagToFonts(Array.from(selectedIds), tagId)
      }
      setShowBatchTagSelect(false)
      setSelectedTagIds(new Set())
      onTagsChange()
    } catch (err) {
      console.error('Batch add tag failed:', err)
    }
  }

  const handleBatchRemoveTag = async () => {
    if (selectedIds.size === 0 || selectedTagIds.size === 0) return
    try {
      for (const tagId of selectedTagIds) {
        await batchRemoveTagFromFonts(Array.from(selectedIds), tagId)
      }
      setShowBatchTagSelect(false)
      setSelectedTagIds(new Set())
      onTagsChange()
    } catch (err) {
      console.error('Batch remove tag failed:', err)
    }
  }

  const toggleBatchTagSelect = (tagId: number) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  // Close batch tag dropdown when clicking outside
  useEffect(() => {
    if (!showBatchTagSelect) return
    const handleClickOutside = (e: MouseEvent) => {
      if (batchTagRef.current && !batchTagRef.current.contains(e.target as Node)) {
        setShowBatchTagSelect(false)
        setSelectedTagIds(new Set())
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showBatchTagSelect])

  const handleDelete = async (font: Font) => {
    if (!confirm(`确定要删除 "${font.family_name} - ${font.style_name}"？`)) return
    if (!confirm(`此操作不可撤销！再次确认删除 "${font.family_name} - ${font.style_name}"？`)) return
    try {
      await deleteFont(font.id)
      onDelete(font.id)
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const renderCJKBadges = (font: Font) => {
    const cjk = cjkInfoMap[font.id]
    if (!cjk) return <Badge variant="outline" className="text-xs">...</Badge>
    if (!cjk.has_cjk) return <Badge variant="secondary" className="text-xs">英</Badge>
    const hasChinese = cjk.supports_sc || cjk.supports_tc
    return (
      <div className="grid grid-cols-2 gap-0.5 justify-items-center w-fit mx-auto">
        {hasChinese && <Badge className="bg-green-100 text-green-800 hover:bg-green-200 text-xs px-1 py-0 h-5">中</Badge>}
        {cjk.supports_ja && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 text-xs px-1 py-0 h-5">日</Badge>}
        {cjk.supports_ko && <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200 text-xs px-1 py-0 h-5">韩</Badge>}
      </div>
    )
  }

  const handleAddTag = async (fontId: number, tagId: number) => {
    try {
      await addTagToFont(fontId, tagId)
      setTagFontId(null)
      onTagsChange()
    } catch (err) {
      console.error('Failed to add tag:', err)
    }
  }

  const handleRemoveTag = async (fontId: number, tagId: number) => {
    try {
      await removeTagFromFont(fontId, tagId)
      onTagsChange()
    } catch (err) {
      console.error('Failed to remove tag:', err)
    }
  }

  // 快速创建标签
  const handleQuickCreateTag = async (fontId: number) => {
    if (!newTagName.trim()) return
    try {
      const newTag = await createTag(newTagName.trim(), '#6b7280')
      await addTagToFont(fontId, newTag.id)
      setNewTagName('')
      onTagsChange()
    } catch (err) {
      console.error('Quick create tag failed:', err)
    }
  }

  // 处理标签选择区域的焦点管理
  useEffect(() => {
    if (tagFontId === null) return
    
    const handleClickOutside = (e: MouseEvent) => {
      if (tagSelectRef.current && !tagSelectRef.current.contains(e.target as Node)) {
        setTagFontId(null)
      }
    }
    
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 100)
    
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [tagFontId])

  const renderTags = (font: Font) => {
    const fontTags = fontTagsMap[font.id] || []
    const availableTags = tags.filter(t => !fontTags.some(ft => ft.id === t.id))
    const isTagSelectOpen = tagFontId === font.id

    return (
      <div 
        ref={isTagSelectOpen ? tagSelectRef : undefined}
        className="flex flex-col gap-1 justify-center items-start min-w-[120px]"
      >
        {fontTags.map(tag => (
          <Badge
            key={tag.id}
            variant="outline"
            className="text-xs cursor-pointer group"
            style={{ backgroundColor: tag.color ? `${tag.color}20` : undefined, borderColor: tag.color }}
            title="点击移除"
            onClick={(e) => {
              e.stopPropagation()
              handleRemoveTag(font.id, tag.id)
            }}
          >
            {tag.name}
            <X className="h-3 w-3 ml-0.5 opacity-0 group-hover:opacity-100" />
          </Badge>
        ))}
        {isTagSelectOpen ? (
          <div 
            className="w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <select
              className="text-xs border rounded px-1 py-0.5 w-full"
              onChange={(e) => {
                if (e.target.value) {
                  handleAddTag(font.id, Number(e.target.value))
                  setTagFontId(null)
                }
              }}
            >
              <option value="">选择标签...</option>
              {availableTags.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <div className="flex gap-1 mt-1">
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="快速创建..."
                className="h-6 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleQuickCreateTag(font.id)
                  }
                }}
              />
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation()
                  handleQuickCreateTag(font.id)
                }}
              >
                +
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => {
              e.stopPropagation()
              setTagFontId(font.id)
              setNewTagName('')
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col p-4 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <Input
            placeholder="搜索字体名称..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={formatFilter}
          onValueChange={(v) => {
            setFormatFilter(v)
            setCurrentPage(1)
          }}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue placeholder="格式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部格式</SelectItem>
            <SelectItem value="ttc">TTC</SelectItem>
            <SelectItem value="otf">OTF</SelectItem>
            <SelectItem value="ttf">TTF</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={langFilter}
          onValueChange={(v) => {
            setLangFilter(v)
            setCurrentPage(1)
          }}
        >
          <SelectTrigger className="w-[100px]">
            <SelectValue placeholder="语言" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部语言</SelectItem>
            <SelectItem value="sc">简体中文</SelectItem>
            <SelectItem value="tc">繁体中文</SelectItem>
            <SelectItem value="ja">日文</SelectItem>
            <SelectItem value="ko">韩文</SelectItem>
            <SelectItem value="none">英</SelectItem>
          </SelectContent>
        </Select>
        {isAdmin && (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            管理员模式
          </Badge>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-center">
                <button
                  className="inline-flex items-center justify-center w-5 h-5 rounded border border-[hsl(var(--input))] hover:border-[hsl(var(--primary))] transition-colors"
                  onClick={toggleSelectAll}
                  title={sorted.length > 0 && sorted.every(f => selectedIds.has(f.id)) ? '取消全选' : '全选'}
                >
                  {sorted.length > 0 && sorted.every(f => selectedIds.has(f.id)) ? (
                    <Check className="h-3 w-3" />
                  ) : selectedIds.size > 0 ? (
                    <div className="w-2.5 h-0.5 bg-[hsl(var(--primary))]" />
                  ) : null}
                </button>
              </TableHead>
              <TableHead className="text-center">
                <div className="flex items-center justify-center gap-1 cursor-pointer" onClick={() => toggleSort('family_name')}>
                  字体名称
                  <ArrowUpDown className="h-3 w-3" />
                </div>
              </TableHead>
              <TableHead className="text-center">预览</TableHead>
              <TableHead className="w-20 text-center">标签</TableHead>
              <TableHead className="w-14 text-center">语言</TableHead>
              {isAdmin && (
                <>
                  <TableHead className="w-16 cursor-pointer text-center" onClick={() => toggleSort('format')}>
                    <div className="flex items-center justify-center gap-1">
                      格式
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="w-20 cursor-pointer text-center" onClick={() => toggleSort('file_size')}>
                    <div className="flex items-center justify-center gap-1">
                      大小
                      <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                </>
              )}
              <TableHead className="w-16 text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 8 : 6} className="h-24 text-center text-[hsl(var(--muted-foreground))]">
                  暂无字体
                </TableCell>
              </TableRow>
            ) : (
              paginatedGroups.map((group) => {
                const isExpanded = expandedFamilies.has(group.family)
                const showHeader = group.hasMultiple
                const fontsToShow = showHeader && !isExpanded ? [] : group.fonts
                const totalSize = group.fonts.reduce((sum, f) => sum + f.file_size, 0)

                return (
                  <React.Fragment key={group.family}>
                    {showHeader && (
                      <TableRow className="bg-muted/30 hover:bg-muted/50">
                        <TableCell className="text-center">
                          <button
                            className="inline-flex items-center justify-center w-5 h-5 rounded border border-[hsl(var(--input))] hover:border-[hsl(var(--primary))] transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleSelectFamily(group.fonts) }}
                          >
                            {group.fonts.every(f => selectedIds.has(f.id)) ? (
                              <Check className="h-3 w-3" />
                            ) : group.fonts.some(f => selectedIds.has(f.id)) ? (
                              <div className="w-2.5 h-0.5 bg-[hsl(var(--primary))]" />
                            ) : null}
                          </button>
                        </TableCell>
                        <TableCell className="font-medium text-center w-[220px] max-w-[220px] overflow-hidden">
                          <div className="flex items-center justify-center gap-1">
                            {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 cursor-pointer" onClick={(e) => { e.stopPropagation(); setExpandedFamilies(prev => { const next = new Set(prev); if (next.has(group.family)) next.delete(group.family); else next.add(group.family); return next; }) }} /> : <ChevronRight className="h-4 w-4 shrink-0 cursor-pointer" onClick={(e) => { e.stopPropagation(); setExpandedFamilies(prev => { const next = new Set(prev); if (next.has(group.family)) next.delete(group.family); else next.add(group.family); return next; }) }} />}
                            <span className="truncate cursor-pointer hover:text-[hsl(var(--primary))]" onClick={() => onFontSelect(group.fonts[0])}>{group.family}</span>
                            <Badge variant="secondary" className="ml-1 shrink-0">{group.fonts.length} 个字重</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <InlinePreview fontId={group.fonts[0].id} fontFormat={group.fonts[0].format} />
                        </TableCell>
                        <TableCell className="text-center">{renderTags(group.fonts[0])}</TableCell>
                        <TableCell className="text-center">{renderCJKBadges(group.fonts[0])}</TableCell>
                        {isAdmin && (
                          <>
                            <TableCell className="text-center">
                              <div className="flex gap-1 justify-center">
                                {[...new Set(group.fonts.map(f => f.format))].map(f => (
                                  <Badge key={f} variant="outline">{f.toUpperCase()}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">{formatFileSize(totalSize)}</TableCell>
                          </>
                        )}
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="下载全部字重"
                              onClick={() => downloadFamilyFonts(group.family)}
                            >
                              <Package className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {fontsToShow.map((font) => (
                      <TableRow
                        key={font.id}
                        className={`cursor-pointer ${showHeader ? 'bg-background' : ''}`}
                        onClick={() => onFontSelect(font)}
                      >
                        <TableCell className="text-center">
                          <button
                            className="inline-flex items-center justify-center w-5 h-5 rounded border border-[hsl(var(--input))] hover:border-[hsl(var(--primary))] transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleSelect(font.id) }}
                          >
                            {selectedIds.has(font.id) && <Check className="h-3 w-3" />}
                          </button>
                        </TableCell>
                        <TableCell className={`font-medium text-center w-[220px] max-w-[220px] overflow-hidden ${showHeader ? 'pl-8' : ''}`}>
                          {!showHeader && <span className="truncate block">{font.family_name}</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <InlinePreview fontId={font.id} fontFormat={font.format} />
                        </TableCell>
                        <TableCell className="text-center">{renderTags(font)}</TableCell>
                        <TableCell className="text-center">{renderCJKBadges(font)}</TableCell>
                        {isAdmin && (
                          <>
                            <TableCell className="text-center">
                              <Badge variant="outline">{font.format.toUpperCase()}</Badge>
                            </TableCell>
                            <TableCell className="text-center">{formatFileSize(font.file_size)}</TableCell>
                          </>
                        )}
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              asChild
                            >
                              <a href={getFontFileUrl(font.id, { download: true })}>
                                <Download className="h-4 w-4" />
                              </a>
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(font)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Batch actions */}
      {selectedIds.size > 0 && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">已选择 {selectedIds.size} 个字体</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              取消选择
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap" ref={batchTagRef}>
            <Button
              size="sm"
              onClick={async () => {
                const ids = Array.from(selectedIds)
                await downloadSelectedFonts(ids)
              }}
            >
              <Download className="h-4 w-4 mr-1" />
              下载选中
            </Button>
            <div className="relative">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={(e) => {
                  e.stopPropagation()
                  if (showBatchTagSelect && batchTagMode === 'add') {
                    setShowBatchTagSelect(false)
                    setSelectedTagIds(new Set())
                  } else {
                    setBatchTagMode('add')
                    setSelectedTagIds(new Set())
                    setShowBatchTagSelect(true)
                  }
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                添加标签
              </Button>
              {showBatchTagSelect && batchTagMode === 'add' && (
                <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-md shadow-lg z-50 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                  <div className="p-2">
                    <p className="text-xs font-medium mb-2">选择标签（可多选）:</p>
                    {tags.map(tag => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-100 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTagIds.has(tag.id)}
                          onChange={() => toggleBatchTagSelect(tag.id)}
                          className="rounded"
                        />
                        {tag.name}
                      </label>
                    ))}
                    {tags.length === 0 && (
                      <p className="text-xs text-gray-500">暂无标签</p>
                    )}
                    {selectedTagIds.size > 0 && (
                      <Button 
                        size="sm" 
                        className="w-full mt-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBatchAddTag()
                        }}
                      >
                        确认添加 ({selectedTagIds.size}个标签)
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="relative">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={(e) => {
                  e.stopPropagation()
                  if (showBatchTagSelect && batchTagMode === 'remove') {
                    setShowBatchTagSelect(false)
                    setSelectedTagIds(new Set())
                  } else {
                    setBatchTagMode('remove')
                    setSelectedTagIds(new Set())
                    setShowBatchTagSelect(true)
                  }
                }}
              >
                <X className="h-4 w-4 mr-1" />
                删除标签
              </Button>
              {showBatchTagSelect && batchTagMode === 'remove' && (
                <div className="absolute bottom-full left-0 mb-1 bg-white border rounded-md shadow-lg z-50 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                  <div className="p-2">
                    <p className="text-xs font-medium mb-2">选择标签（可多选）:</p>
                    {tags.map(tag => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 px-2 py-1 text-sm hover:bg-gray-100 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTagIds.has(tag.id)}
                          onChange={() => toggleBatchTagSelect(tag.id)}
                          className="rounded"
                        />
                        {tag.name}
                      </label>
                    ))}
                    {tags.length === 0 && (
                      <p className="text-xs text-gray-500">暂无标签</p>
                    )}
                    {selectedTagIds.size > 0 && (
                      <Button 
                        size="sm" 
                        variant="destructive"
                        className="w-full mt-2"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleBatchRemoveTag()
                        }}
                      >
                        确认删除 ({selectedTagIds.size}个标签)
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            共 {sorted.length} 个字体（{familyGroups.length} 个家族），第 {currentPage}/{totalPages} 页
          </p>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number
                if (totalPages <= 5) {
                  page = i + 1
                } else if (currentPage <= 3) {
                  page = i + 1
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i
                } else {
                  page = currentPage - 2 + i
                }
                return (
                  <PaginationItem key={page}>
                    <PaginationLink
                      onClick={() => setCurrentPage(page)}
                      isActive={currentPage === page}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                )
              })}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
}
