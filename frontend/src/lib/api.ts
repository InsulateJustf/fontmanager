const API_BASE = '/api'

export interface Font {
  id: number
  family_name: string
  style_name: string
  format: string
  file_size: number
  file_hash: string
  stored_filename: string
  original_filename: string
  cjk_info: string | null
  subfonts_info: string | null
  created_at: string
}

export interface CJKInfo {
  has_cjk: boolean
  cjk_count: number
  supports_sc: boolean
  supports_tc: boolean
  supports_ja: boolean
  supports_ko: boolean
  languages: string[]
  warning: string | null
}

export interface SubFont {
  index: number
  family_name: string
  style_name: string
  region: string
  weight: string
  variant: string
}

export interface Tag {
  id: number
  name: string
  color: string
  count: number
}

export interface UploadResult {
  filename: string
  status: 'success' | 'duplicate' | 'skipped' | 'error'
  message: string
  family_name?: string
  style_name?: string
}

export async function fetchFonts(): Promise<Font[]> {
  const res = await fetch(`${API_BASE}/fonts`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch fonts')
  return data.fonts
}

export async function fetchCJKInfo(fontId: number, subfontIndex?: number): Promise<CJKInfo> {
  let url = `${API_BASE}/fonts/${fontId}/cjk`
  if (subfontIndex !== undefined) url += `?subfont=${subfontIndex}`
  const res = await fetch(url)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch CJK info')
  return data.cjk
}

export async function fetchSubFonts(fontId: number): Promise<SubFont[]> {
  const res = await fetch(`${API_BASE}/fonts/${fontId}/subfonts`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch subfonts')
  return data.subfonts
}

export async function uploadFiles(files: FileList): Promise<UploadResult[]> {
  const formData = new FormData()
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i])
  }
  const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Upload failed')
  return data.results
}

export async function deleteFont(fontId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/fonts/${fontId}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Delete failed')
}

export function getFontFileUrl(fontId: number, options?: { download?: boolean; subfont?: number }): string {
  let url = `${API_BASE}/fonts/${fontId}/file`
  const params = new URLSearchParams()
  if (options?.download) params.set('download', '1')
  if (options?.subfont !== undefined) params.set('subfont', String(options.subfont))
  const qs = params.toString()
  if (qs) url += `?${qs}`
  return url
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/tags`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch tags')
  return data.tags
}

export async function createTag(name: string, color: string): Promise<Tag> {
  const res = await fetch(`${API_BASE}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to create tag')
  return data.tag
}

export async function deleteTag(tagId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/tags/${tagId}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to delete tag')
}

export async function addTagToFont(fontId: number, tagId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/fonts/${fontId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_id: tagId }),
  })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to add tag')
}

export async function removeTagFromFont(fontId: number, tagId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/fonts/${fontId}/tags/${tagId}`, { method: 'DELETE' })
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to remove tag')
}

export async function getFontTags(fontId: number): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/fonts/${fontId}/tags`)
  const data = await res.json()
  if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch font tags')
  return data.tags
}

export async function downloadAllFonts(): Promise<void> {
  window.open(`${API_BASE}/fonts/download-all`, '_blank')
}

export function downloadFamilyFonts(familyName: string): void {
  window.open(`${API_BASE}/fonts/download-family?name=${encodeURIComponent(familyName)}`, '_blank')
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}
