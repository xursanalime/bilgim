import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { mediaApi, type MediaAssetBatchResult } from '../api/media';

/**
 * Resolves metadata + a signed playback URL for a page of chat
 * attachments in a single request, instead of every message bubble
 * firing its own `getAssetMetadata` + `getPlaybackUrl` pair on mount
 * (a 20-attachment page used to issue 40 round-trips).
 *
 * Callers pass every `assetId` visible in the current message list;
 * this hook dedupes/sorts them into a stable query key (so paging in
 * new messages doesn't invalidate the whole batch) and returns a
 * `Map` keyed by asset id for O(1) per-bubble lookups.
 */
export function useAssetBatch(assetIds: (string | null | undefined)[]) {
  const key = useMemo(
    () => [...new Set(assetIds.filter((id): id is string => !!id))].sort(),
    [assetIds],
  );

  const query = useQuery({
    queryKey: ['media', 'assets-batch', key],
    queryFn: () => mediaApi.getAssetsBatch(key),
    enabled: key.length > 0,
    staleTime: 60_000,
  });

  const byAssetId = useMemo(() => {
    const map = new Map<string, MediaAssetBatchResult>();
    for (const item of query.data ?? []) map.set(item.assetId, item);
    return map;
  }, [query.data]);

  return { ...query, byAssetId };
}
