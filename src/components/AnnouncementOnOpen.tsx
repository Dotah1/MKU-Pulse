import { useCallback, useEffect, useState } from "react";
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

type CampusAnnouncement = Pick<AppNotification, "id" | "title" | "body">;

export function AnnouncementOnOpen() {
  const { user } = useCampus();
  const userId = user?.id ?? null;
  const [announcement, setAnnouncement] = useState<CampusAnnouncement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadNextAnnouncement = useCallback(async () => {
    if (!userId) {
      setAnnouncement(null);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body")
      .eq("user_id", userId)
      .eq("kind", "announcement")
      .is("read_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const nextAnnouncement = !error && data ? (data as CampusAnnouncement) : null;
    setAnnouncement(nextAnnouncement);
    setOpen(Boolean(nextAnnouncement));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadNextAnnouncement();
    if (!userId) return;

    const channel = supabase
      .channel(`announcements-on-open-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => void loadNextAnnouncement(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, loadNextAnnouncement]);

  const dismiss = async () => {
    const current = announcement;
    setOpen(false);
    if (!current || !userId) return;

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("user_id", userId)
      .eq("kind", "announcement")
      .is("read_at", null);

    if (error) {
      setOpen(true);
      return;
    }

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
            <DialogTitle>{announcement.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap break-words">
              {announcement.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => void dismiss()}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
