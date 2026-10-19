import { useCallback, useState } from "react";
import { uploadQuietly } from "@/lib/quietSend";

/**
 * A file a person chose, uploaded with quiet retries (src/lib/quietSend.ts).
 * A file that still has not gone up stays selected (`pending`), so sending it
 * again never means choosing it again. Nothing here shows a failure: the
 * screen shows the file as uploaded, uploading, or not uploaded yet.
 *
 * `upload` must write the same file to the same path every time it is
 * called (a path made from the file, with upsert), so a repeat is harmless.
 */
export function useQuietUpload<R>(upload: (file: File) => PromiseLike<{ error: unknown; result?: R }>, onUploaded: (file: File, result: R | undefined) => void) {
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const send = useCallback(async (file: File) => {
    setUploading(true);
    const reply = await uploadQuietly(() => upload(file));
    setUploading(false);
    if (reply.error) {
      console.warn("[upload] not uploaded yet", reply.error);
      setPending(file);
      return false;
    }
    setPending(null);
    onUploaded(file, reply.result);
    return true;
  }, [upload, onUploaded]);
  const again = useCallback(() => (pending ? send(pending) : Promise.resolve(false)), [pending, send]);
  return { send, again, uploading, pending };
}

/** A storage path made from the file itself, so sending the same file again writes the same object. */
export function fileKey(file: File): string {
  const ext = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${file.lastModified}-${file.size}.${ext}`;
}
