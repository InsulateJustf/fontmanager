
import { Badge } from '@/components/ui/badge'
import type { UploadResult } from '@/lib/api'

interface UploadResultsProps {
  results: UploadResult[]
  onClose: () => void
}

export function UploadResults({ results, onClose }: UploadResultsProps) {
  if (results.length === 0) return null

  const successCount = results.filter(r => r.status === 'success').length
  const duplicateCount = results.filter(r => r.status === 'duplicate').length
  const skippedCount = results.filter(r => r.status === 'skipped').length
  const errorCount = results.filter(r => r.status === 'error').length

  return (
    <div className="border rounded-lg p-4 mb-4 bg-[hsl(var(--card))]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">上传结果</h3>
        <button
          onClick={onClose}
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          ✕
        </button>
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        {successCount > 0 && <Badge className="bg-green-100 text-green-800">✅ {successCount} 成功</Badge>}
        {duplicateCount > 0 && <Badge className="bg-yellow-100 text-yellow-800">⚠️ {duplicateCount} 重复</Badge>}
        {skippedCount > 0 && <Badge className="bg-gray-100 text-gray-800">⏭️ {skippedCount} 跳过</Badge>}
        {errorCount > 0 && <Badge variant="destructive">❌ {errorCount} 失败</Badge>}
      </div>
      <div className="max-h-[200px] overflow-auto space-y-1">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
            <span className="flex-shrink-0">
              {r.status === 'success' && '✅'}
              {r.status === 'duplicate' && '⚠️'}
              {r.status === 'skipped' && '⏭️'}
              {r.status === 'error' && '❌'}
            </span>
            <span className="flex-1 truncate">{r.filename}</span>
            <span className="text-[hsl(var(--muted-foreground))] text-xs">{r.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
