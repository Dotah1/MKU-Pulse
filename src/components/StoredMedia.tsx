import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function useStoredUrl(bucket: string, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setUrl(null);
      return;
    }
    getSignedUrl(bucket, path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [bucket, path]);
  return url;
}

export function UserAvatar({
  path,
  name,
  className,
}: {
  path: string | null | undefined;
  name: string;
  className?: string;
}) {
  const url = useStoredUrl("avatars", path);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground",
        "size-10 text-sm font-semibold",
        className,
      )}
    >
      {url ? (
        <img src={url} alt={`${name}'s profile photo`} className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials || "?"}</span>
      )}
    </span>
  );
}

export function StoredImage({
  path,
  alt,
  className,
}: {
  path: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const url = useStoredUrl("media", path);
  if (!url) return null;
  return <img src={url} alt={alt} loading="lazy" className={className} />;
}

export function StoredVideo({
  path,
  className,
}: {
  path: string | null | undefined;
  className?: string;
}) {
  const url = useStoredUrl("media", path);
  if (!url) return null;
  return <video src={url} controls playsInline className={className} />;
}
