import { useState, useEffect, useCallback } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { FontTable } from '@/components/FontTable'
import { FontPreview } from '@/components/FontPreview'
import { UploadResults } from '@/components/UploadResults'
import { Toaster } from '@/components/ui/toaster'
import { toast } from '@/components/ui/use-toast'
import type { Font, CJKInfo, Tag, UploadResult } from '@/lib/api'
import { fetchFonts, fetchCJKInfo, fetchTags, getFontTags } from '@/lib/api'

function App() {
  const [fonts, setFonts] = useState<Font[]>([])
  const [cjkInfoMap, setCjkInfoMap] = useState<Record<number, CJKInfo>>({})
  const [tags, setTags] = useState<Tag[]>([])
  const [fontTagsMap, setFontTagsMap] = useState<Record<number, Tag[]>>({})
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null)
  const [selectedFont, setSelectedFont] = useState<Font | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([])
  const [showUploadResults, setShowUploadResults] = useState(false)

  const loadFontTags = useCallback(async (fontIds: number[]) => {
    const newMap: Record<number, Tag[]> = {}
    for (const id of fontIds) {
      try {
        const tagList = await getFontTags(id)
        newMap[id] = tagList
      } catch (err) {
        newMap[id] = []
      }
    }
    setFontTagsMap(newMap)
  }, [])

  const loadTags = useCallback(async () => {
    try {
      const data = await fetchTags()
      setTags(data)
    } catch (err) {
      console.error('Failed to load tags:', err)
    }
  }, [])

  const loadFonts = useCallback(async () => {
    try {
      const data = await fetchFonts()
      setFonts(data)
      // Fetch CJK info for each font
      for (const font of data) {
        if (!cjkInfoMap[font.id]) {
          fetchCJKInfo(font.id)
            .then((info) => {
              setCjkInfoMap((prev) => ({ ...prev, [font.id]: info }))
            })
            .catch(console.error)
        }
      }
      // Load font tags
      await loadFontTags(data.map(f => f.id))
    } catch (err) {
      console.error('Failed to load fonts:', err)
    }
  }, [cjkInfoMap, loadFontTags])

  useEffect(() => {
    loadFonts()
    loadTags()
  }, [])

  const handleUploadComplete = (results: UploadResult[]) => {
    setUploadResults(results)
    setShowUploadResults(true)
    loadFonts()
    loadTags()
    toast({
      title: '上传完成',
      description: `${results.filter(r => r.status === 'success').length} 个字体已入库`,
    })
  }

  const handleFontSelect = (font: Font) => {
    setSelectedFont(font)
    setPreviewOpen(true)
  }

  const handleDelete = (fontId: number) => {
    setFonts((prev) => prev.filter((f) => f.id !== fontId))
    if (selectedFont?.id === fontId) {
      setSelectedFont(null)
      setPreviewOpen(false)
    }
  }

  // Filter by tag
  const filteredFonts = selectedTagId
    ? fonts.filter(() => {
        // TODO: filter by tag when tag API is connected
        return true
      })
    : fonts

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        fonts={fonts}
        tags={tags}
        selectedTagId={selectedTagId}
        onTagSelect={setSelectedTagId}
        onUploadComplete={handleUploadComplete}
        onTagsChange={loadTags}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        {showUploadResults && (
          <div className="px-4 pt-4">
            <UploadResults
              results={uploadResults}
              onClose={() => setShowUploadResults(false)}
            />
          </div>
        )}
        <FontTable
          fonts={filteredFonts}
          cjkInfoMap={cjkInfoMap}
          tags={tags}
          fontTagsMap={fontTagsMap}
          selectedTagId={selectedTagId}
          onFontSelect={handleFontSelect}
          onDelete={handleDelete}
          onTagsChange={() => { loadTags(); loadFontTags(fonts.map(f => f.id)) }}
        />
      </main>
      <FontPreview
        font={selectedFont}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onDelete={handleDelete}
      />
      <Toaster />
    </div>
  )
}

export default App
