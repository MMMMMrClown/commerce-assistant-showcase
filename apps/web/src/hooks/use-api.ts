'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

export function useApi<T>(url: string, initialData: T | null = null) {
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState('');
  const useInitialResponse = useRef(initialData !== null);
  const activeRequest = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(url, { signal: controller.signal });
      if (!controller.signal.aborted) setData(response.data.data as T);
    } catch (err) {
      if (!controller.signal.aborted) setError(errorMessage(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    if (useInitialResponse.current) {
      useInitialResponse.current = false;
    } else {
      void reload();
    }
    return () => activeRequest.current?.abort();
  }, [reload]);
  return { data, loading, error, reload, setData };
}
