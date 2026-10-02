/* Compatibility shim for clients that still reference the previous FCM worker path. */
importScripts(new URL(`/sw.js${self.location.search}`, self.location.origin).toString());
