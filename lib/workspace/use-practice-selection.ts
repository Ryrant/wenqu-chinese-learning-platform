import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";

/** 页面隐藏后仍保留选择，但只在自己的路由消费或更新链接参数。 */
export function usePracticeSelection(path: string, key: string, initial = "", enabled = true) {
  const { pathname, key: locationKey } = useLocation();
  const navigation = useNavigationType();
  const [query, setQuery] = useSearchParams();
  const incoming = enabled && pathname === path ? query.get(key) : null;
  const [value, setValue] = useState(() => incoming ?? initial);
  const pendingSelection = useRef<{ query: string | null; locationKey: string } | null>(null);
  useEffect(() => {
    if (!enabled || pathname !== path) return;
    // 等待 Router 确认本次选字，避免旧链接参数覆盖刚选回的默认内容。
    const pending = pendingSelection.current;
    if (pending && incoming !== pending.query && locationKey === pending.locationKey) return;
    pendingSelection.current = null;
    if (incoming !== null) setValue(incoming);
    else if (navigation === "POP") setValue(initial);
    else if (value !== initial) setQuery((current) => { const next = new URLSearchParams(current); next.set(key, value); return next; }, { replace: true });
  }, [enabled, pathname, path, locationKey, navigation, incoming, value, initial, key, setQuery]);
  const select = useCallback((next: string) => {
    if (enabled && window.location.pathname === path) pendingSelection.current = { query: next === initial ? null : next, locationKey };
    setValue(next);
    if (enabled && window.location.pathname === path) setQuery((current) => { const query = new URLSearchParams(current); if (next === initial) query.delete(key); else query.set(key, next); return query; });
  }, [enabled, path, key, initial, locationKey, setQuery]);
  return [value, select] as const;
}
