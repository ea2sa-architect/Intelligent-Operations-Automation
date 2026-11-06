import { useQuery } from '@tanstack/react-query'
import { tags as tagsApi } from '../lib/api'

export function useTags() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn:  tagsApi.list,
    staleTime: 60_000,
  })

  // name → tag object lookup (lowercase key for case-insensitive matching)
  const tagMap = Object.fromEntries(data.map(t => [t.name.toLowerCase(), t]))

  const folderTags     = data.filter(t => t.role === 'folder')
  const governanceTags = data.filter(t => t.role === 'governance')

  return { tags: data, tagMap, folderTags, governanceTags, isLoading }
}
