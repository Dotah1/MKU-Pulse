import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCampus } from "@/hooks/useCampus";
import { supabase } from "@/integrations/supabase/client";
import type { AppNotification } from "@/hooks/useNotifications";
import { getAnnouncementMetadata, isAnnouncementExpired } from "@/lib/announcement";
import { StoredImage } from "@/components/StoredMedia";

type CampusAnnouncement = Pick<AppNotification, "id" | "title" | "body" | "url">;

export function AnnouncementOnOpen() {
  const { user } = useCampus();
  const userId = user?.id ?? null;
  const [announcement, setAnnouncement] = useState<CampusAnnouncement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadRequestId = useRef(0);

  const loadNextAnnouncement = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!userId) {
      setAnnouncement(null);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, url")
        .eq("user_id", userId)
        .eq("kind", "announcement")
        .is("read_at", null)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      if (loadRequestId.current !== requestId) return;

      for (const row of (data ?? []) as CampusAnnouncement[]) {
        if (loadRequestId.current !== requestId) return;
        if (isAnnouncementExpired(row.url)) {
          await supabase
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("user_id", userId)
            .is("read_at", null);
          if (loadRequestId.current !== requestId) return;
          continue;
        }

        // Mark the message as seen before displaying it, preventing it from
        // appearing again on reload or on another device after it was shown.
        const { data: claimed, error: readError } = await supabase
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("user_id", userId)
          .eq("kind", "announcement")
          .is("read_at", null)
          .select("id")
          .maybeSingle();
        if (readError) throw readError;
        if (loadRequestId.current !== requestId) return;
        if (!claimed) continue;

        setAnnouncement(row);
        setOpen(true);
        return;
      }

      setAnnouncement(null);
      setOpen(false);
    } catch {
      if (loadRequestId.current === requestId) {
        setAnnouncement(null);
        setOpen(false);
      }
    } finally {
      if (loadRequestId.current === requestId) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setAnnouncement(null);
    setOpen(false);
    void loadNextAnnouncement();
  }, [userId, loadNextAnnouncement]);

  const dismiss = async () => {
    setOpen(false);
    setAnnouncement(null);
    await loadNextAnnouncement();
  };

  return (
    <Dialog
      open={open && !loading && Boolean(announcement)}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
        else void dismiss();
      }}
    >
      {announcement && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="break-words [overflow-wrap:anywhere]">
              {announcement.title}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words">
              {announcement.body}
            </DialogDescription>
          </DialogHeader>
          {getAnnouncementMetadata(announcement.url).imagePath && (
            <StoredImage
              path={getAnnouncementMetadata(announcement.url).imagePath}
              alt="Campus announcement"
              className="max-h-72 w-full rounded-lg object-cover"
            />
          )}
          <DialogFooter>
            <Button onClick={() => void dismiss()}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
