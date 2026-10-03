import { useEffect, useRef, useState } from "react";

/** Track whether an element is close to the viewport so expensive work can be deferred. */
export function useNearViewport<T extends Element>(rootMargin = "320px 0px", once = true) {
  const elementRef = useRef<T | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = Boolean(entry?.isIntersecting);
        setIsNearViewport(isIntersecting);
        if (once && isIntersecting) observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, rootMargin]);

  return [elementRef, isNearViewport] as const;
}
