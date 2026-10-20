/** 浏览器恢复时通常连续发出 visibilitychange 和 focus，同一次恢复只重新读取一次。 */
export function observePageResume(
  onResume: () => void,
  windowTarget: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
  now: () => number = () => performance.now(),
) {
  let lastResume = -Infinity;
  const resume = () => {
    if (documentTarget.visibilityState === "hidden") return;
    const current = now();
    if (current - lastResume < 1000) return;
    lastResume = current;
    onResume();
  };
  windowTarget.addEventListener("focus", resume);
  documentTarget.addEventListener("visibilitychange", resume);
  return () => {
    windowTarget.removeEventListener("focus", resume);
    documentTarget.removeEventListener("visibilitychange", resume);
  };
}
