import { useEffect, useRef, useState } from "react";
import { captureOneFrame, cropDataUrl, dataUrlToPayload, readImageFile, redactRect, stopTracks, type CropRect } from "../capture";
import { Icon } from "./Icon";

interface Props {
  onConfirm: (payload: { imageBase64: string; imageMediaType: string } | undefined) => void;
  disabled?: boolean;
  onClose?: () => void;
}

const defaultCrop = (width: number, height: number): CropRect => ({
  x: 0, y: 0, width, height,
});

export function ScreenshotCheck({ onConfirm, disabled, onClose }: Props) {
  const [preview, setPreview] = useState<string>("");
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const revisionRef = useRef(0);

  const release = () => {
    revisionRef.current++;
    controllerRef.current?.abort();
    stopTracks(streamRef.current);
    streamRef.current = null;
  };

  useEffect(() => {
    const onLeave = () => release();
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      release();
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, []);

  const capture = async () => {
    onConfirm(undefined);
    setError("");
    setBusy(true);
    try {
      controllerRef.current = new AbortController();
      const frame = await captureOneFrame(undefined, controllerRef.current.signal);
      setPreview(frame.dataUrl);
      setCrop(defaultCrop(frame.width, frame.height));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Screen capture cancelled");
    } finally {
      release();
      setBusy(false);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (disabled || busy) return;
    setBusy(true); setError("");
    const revision = ++revisionRef.current;
    try {
      const payload = await readImageFile(file);
      if (revision === revisionRef.current) { setPreview(""); onConfirm(payload); }
    } catch { setError("Use a valid PNG, JPEG or WebP image under 5 MB."); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!preview) return;
    const revision = revisionRef.current;
    setBusy(true);
    try {
      const cropped = crop.width && crop.height ? await cropDataUrl(preview, crop) : preview;
      if (revision === revisionRef.current) onConfirm(dataUrlToPayload(cropped));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare screenshot");
    } finally {
      setBusy(false);
    }
  };

  const redactCenter = async () => {
    if (!preview) return;
    onConfirm(undefined);
    const revision = ++revisionRef.current;
    setBusy(true);
    try {
      const next = await redactRect(preview, crop);
      if (revision === revisionRef.current) setPreview(next);
    } catch { setError("Could not redact screenshot"); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel">
      <div className="image-actions">
        <button type="button" disabled={disabled || busy} onClick={() => void capture()}>
          <Icon name="camera" /> Capture screen
        </button>
        <label className="file">
          Upload
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={(event) => { void onFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </label>
        <button type="button" className="image-close" aria-label="Close image options" onClick={onClose}><Icon name="close" /></button>
      </div>
      {!preview ? <p className="image-hint">Or drop / paste an image anywhere.</p> : <img className="capture-preview" src={preview} alt="Local screenshot preview" />}
      {preview ? (
        <>
        <details><summary>Crop or hide details</summary>
        <fieldset className="crop" disabled={busy || disabled} onChange={() => { revisionRef.current++; onConfirm(undefined); }}>
          <label>
            Crop X
            <input type="number" value={crop.x} onChange={(event) => setCrop({ ...crop, x: Number(event.target.value) })} />
          </label>
          <label>
            Crop Y
            <input type="number" value={crop.y} onChange={(event) => setCrop({ ...crop, y: Number(event.target.value) })} />
          </label>
          <label>
            Width
            <input type="number" value={crop.width} onChange={(event) => setCrop({ ...crop, width: Number(event.target.value) })} />
          </label>
          <label>
            Height
            <input type="number" value={crop.height} onChange={(event) => setCrop({ ...crop, height: Number(event.target.value) })} />
          </label>
          <button type="button" onClick={() => void redactCenter()}>
            Redact selected region
          </button>
        </fieldset>
        </details>
        <div className="image-actions">
          <button type="button" className="primary" disabled={busy || disabled} onClick={() => void confirm()}>
            Use this screenshot
          </button>
          <button type="button" onClick={() => { revisionRef.current++; setPreview(""); onConfirm(undefined); }}>
            Cancel
          </button>
        </div>
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
