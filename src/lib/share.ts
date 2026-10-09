import { toast } from "@/lib/toast";

interface WhatsAppSharePayload {
  title: string;
  text: string;
  url: string;
}

async function copyLink(url: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Use the legacy copy path below when clipboard permissions are unavailable.
  }

  const field = document.createElement("textarea");
  field.value = url;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

/** Share a public campus link via the system share sheet, or WhatsApp Web. */
export async function shareToWhatsApp({ title, text, url }: WhatsAppSharePayload): Promise<void> {
  const absoluteUrl = new URL(url, window.location.origin).toString();
  const shareText = `${text}\n${absoluteUrl}`;

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // Fall through to the WhatsApp Web and copy-link fallback.
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  const copied = await copyLink(absoluteUrl);
  toast.success(
    copied
      ? "WhatsApp is opening. The link is copied—paste it into Status or a chat."
      : "WhatsApp is opening with your campus link.",
  );
}
