import React, { useState } from 'react'
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
import { Eye, Download, Trash2, Search, ArrowUpDown, Plus, X, ChevronDown, ChevronRight, Package, Check } from 'lucide-react'
import type { Font, CJKInfo, Tag as TagType } from '@/lib/api'
import { deleteFont, getFontFileUrl, formatFileSize, addTagToFont, removeTagFromFont, downloadFamilyFonts, downloadSelectedFonts } from '@/lib/api'

interface FontTableProps {
  fonts: Font[]
  cjkInfoMap: Record<number, CJKInfo>
  tags: TagType[]
  fontTagsMap: Record<number, TagType[]>
  selectedTagId: number | null
  onFontSelect: (font: Font) => void
  onDelete: (fontId: number) => void
  onTagsChange: () => void
}

type SortField = 'family_name' | 'style_name' | 'format' | 'file_size'
type SortDirection = 'asc' | 'desc'

export function FontTable({
  fonts,
  cjkInfoMap,
  tags,
  fontTagsMap,
  selectedTagId,
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

  // Filter
  const filtered = fonts.filter((font) => {
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

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    switch (sortField) {
      case 'family_name':
        cmp = a.family_name.localeCompare(b.family_name)
        break
      case 'style_name':
        cmp = a.style_name.localeCompare(b.style_name)
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

  // Group sorted fonts by family_name for display
  const familyGroups: { family: string; fonts: Font[]; hasMultiple: boolean }[] = []
  const familyMap = new Map<string, Font[]>()
  for (const font of sorted) {
    const key = font.family_name
    if (!familyMap.has(key)) familyMap.set(key, [])
    familyMap.get(key)!.push(font)
  }
  for (const [family, groupFonts] of familyMap) {
    familyGroups.push({ family, fonts: groupFonts, hasMultiple: groupFonts.length > 1 })
  }

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

  const toggleFamily = (family: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev)
      if (next.has(family)) next.delete(family)
      else next.add(family)
      return next
    })
  }

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectFamily = (familyFonts: Font[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = familyFonts.every(f => next.has(f.id))
      if (allSelected) {
        familyFonts.forEach(f => next.delete(f.id))
      } else {
        familyFonts.forEach(f => next.add(f.id))
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allFilteredIds = sorted.map(f => f.id)
      const allSelected = allFilteredIds.every(id => prev.has(id))
      if (allSelected) return new Set()
      return new Set(allFilteredIds)
    })
  }

  const selectedCount = selectedIds.size

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0) return
    try {
      await downloadSelectedFonts(Array.from(selectedIds))
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

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
    if (!cjk) return <Badge variant="outline">检测中...</Badge>
    if (!cjk.has_cjk) return <Badge variant="secondary">无中文</Badge>
    return (
      <div className="flex gap-1 flex-wrap justify-center">
        {cjk.supports_sc && <Badge className="bg-green-100 text-green-800 hover:bg-green-200">简</Badge>}
        {cjk.supports_tc && <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">繁</Badge>}
        {cjk.supports_ja && <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200">日</Badge>}
        {cjk.supports_ko && <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200">韩</Badge>}
        {cjk.warning && (
          <Badge variant="destructive" className="text-xs">
            ⚠️ {cjk.warning}
          </Badge>
        )}
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

  const renderTags = (font: Font) => {
    const fontTags = fontTagsMap[font.id] || []
    const availableTags = tags.filter(t => !fontTags.some(ft => ft.id === t.id))
    return (
      <div className="flex flex-wrap gap-1 justify-center items-center">
        {fontTags.map(tag => (
          <Badge
            key={tag.id}
            variant="outline"
            className="text-xs cursor-pointer group"
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
        {tagFontId === font.id ? (
          <select
            className="text-xs border rounded px-1 py-0.5"
            autoFocus
            onBlur={() => setTagFontId(null)}
            onChange={(e) => {
              if (e.target.value) handleAddTag(font.id, Number(e.target.value))
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">选择标签...</option>
            {availableTags.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={(e) => {
              e.stopPropagation()
              setTagFontId(font.id)
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
            <SelectItem value="none">无中文</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center">
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
              <TableHead className="cursor-pointer text-center" onClick={() => toggleSort('family_name')}>
                <div className="flex items-center justify-center gap-1">
                  字体名称
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-center" onClick={() => toggleSort('style_name')}>
                <div className="flex items-center justify-center gap-1">
                  样式
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="text-center">标签</TableHead>
              <TableHead className="text-center">中文支持</TableHead>
              <TableHead className="cursor-pointer text-center" onClick={() => toggleSort('format')}>
                <div className="flex items-center justify-center gap-1">
                  格式
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="cursor-pointer text-center" onClick={() => toggleSort('file_size')}>
                <div className="flex items-center justify-center gap-1">
                  大小
                  <ArrowUpDown className="h-4 w-4" />
                </div>
              </TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-[hsl(var(--muted-foreground))]">
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
                        <TableCell className="font-medium text-center">
                          <button
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={(e) => { e.stopPropagation(); toggleFamily(group.family) }}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {group.family}
                            <Badge variant="secondary" className="ml-1 text-xs">{group.fonts.length}</Badge>
                          </button>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{group.fonts.length} 个字重</Badge>
                        </TableCell>
                        <TableCell className="text-center">{renderTags(group.fonts[0])}</TableCell>
                        <TableCell className="text-center">{renderCJKBadges(group.fonts[0])}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex gap-1 justify-center">
                            {[...new Set(group.fonts.map(f => f.format))].map(f => (
                              <Badge key={f} variant="outline">{f.toUpperCase()}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">{formatFileSize(totalSize)}</TableCell>
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
                            className={`inline-flex items-center justify-center w-5 h-5 rounded border border-[hsl(var(--input))] hover:border-[hsl(var(--primary))] transition-colors ${showHeader ? '' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleSelect(font.id) }}
                          >
                            {selectedIds.has(font.id) && <Check className="h-3 w-3" />}
                          </button>
                        </TableCell>
                        <TableCell className={`font-medium text-center ${showHeader ? 'pl-8' : ''}`}>
                          {!showHeader && font.family_name}
                        </TableCell>
                        <TableCell className="text-center">
                          {font.format === 'ttc' ? (
                            <Badge variant="secondary">多样式</Badge>
                          ) : (
                            font.style_name
                          )}
                        </TableCell>
                        <TableCell className="text-center">{renderTags(font)}</TableCell>
                        <TableCell className="text-center">{renderCJKBadges(font)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{font.format.toUpperCase()}</Badge>
                        </TableCell>
                        <TableCell className="text-center">{formatFileSize(font.file_size)}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => onFontSelect(font)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
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
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(font)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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

      {/* Selection action bar */}
      {selectedCount > 0 && (
        <div className="mt-3 flex items-center justify-between bg-[hsl(var(--card))] border rounded-lg px-4 py-2">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            已选择 {selectedCount} 个字体
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
              取消选择
            </Button>
            <Button size="sm" onClick={handleDownloadSelected}>
              <Download className="h-4 w-4 mr-1" />
              下载选中
            </Button>
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
