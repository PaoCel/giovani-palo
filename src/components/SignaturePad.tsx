import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { AppIcon } from "@/components/AppIcon";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  toBlob: () => Promise<Blob | null>;
}

interface SignaturePadProps {
  initialDataUrl?: string | null;
  disabled?: boolean;
  onChange?: (hasContent: boolean) => void;
  onClear?: () => void;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ initialDataUrl, disabled, onChange, onClear }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const initialAppliedRef = useRef(false);
    const hasContentRef = useRef(false);
    const [hasContent, setHasContent] = useState(Boolean(initialDataUrl));
    const [showInitialPreview, setShowInitialPreview] = useState(Boolean(initialDataUrl));

    function reportChange(next: boolean) {
      hasContentRef.current = next;

      if (hasContent !== next) {
        setHasContent(next);
        onChange?.(next);
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        isEmpty: () => !hasContentRef.current,
        clear: () => {
          const canvas = canvasRef.current;

          if (!canvas) {
            return;
          }

          const context = canvas.getContext("2d");

          if (!context) {
            return;
          }

          context.clearRect(0, 0, canvas.width, canvas.height);
          paintBackground(context, canvas.width, canvas.height);
          setShowInitialPreview(false);
          reportChange(false);
        },
        toBlob: () =>
          new Promise<Blob | null>((resolve) => {
            const canvas = canvasRef.current;

            if (!canvas) {
              resolve(null);
              return;
            }

            resolveSignatureBlob(canvas).then(resolve);
          }),
      }),
      [],
    );

    useLayoutEffect(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;

      if (!canvas || !container) {
        return;
      }

      function fitCanvas(canvasEl: HTMLCanvasElement, containerEl: HTMLDivElement) {
        const rect = containerEl.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        const previousData =
          hasContentRef.current && canvasEl.width > 0 ? canvasEl.toDataURL() : null;

        canvasEl.width = Math.max(rect.width, 320) * ratio;
        canvasEl.height = 180 * ratio;
        canvasEl.style.width = `${Math.max(rect.width, 320)}px`;
        canvasEl.style.height = `180px`;

        const context = canvasEl.getContext("2d");

        if (!context) {
          return;
        }

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.scale(ratio, ratio);
        paintBackground(context, canvasEl.width / ratio, canvasEl.height / ratio);

        if (previousData) {
          const image = new Image();
          image.onload = () => {
            context.drawImage(image, 0, 0, canvasEl.width / ratio, canvasEl.height / ratio);
          };
          image.src = previousData;
        }
      }

      fitCanvas(canvas, container);

      const observer = new ResizeObserver(() => fitCanvas(canvas, container));
      observer.observe(container);

      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      if (!initialDataUrl || initialAppliedRef.current) {
        return;
      }

      initialAppliedRef.current = true;
    }, [initialDataUrl]);

    function paintBackground(context: CanvasRenderingContext2D, width: number, height: number) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      const ratio = window.devicePixelRatio || 1;
      const physicalWidth = width * ratio;
      const physicalHeight = height * ratio;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, physicalWidth, physicalHeight);
      context.restore();
    }

    function getPointerPosition(eventArg: ReactPointerEvent<HTMLCanvasElement>) {
      const canvas = canvasRef.current;
      if (!canvas) {
        return null;
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: eventArg.clientX - rect.left,
        y: eventArg.clientY - rect.top,
      };
    }

    function handlePointerDown(eventArg: ReactPointerEvent<HTMLCanvasElement>) {
      if (disabled) return;
      eventArg.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(eventArg.pointerId);
      drawingRef.current = true;
      lastPointRef.current = getPointerPosition(eventArg);
      setShowInitialPreview(false);

      const context = canvas.getContext("2d");
      const point = lastPointRef.current;
      if (context && point) {
        context.fillStyle = "#101c30";
        context.beginPath();
        context.arc(point.x, point.y, 1.2, 0, Math.PI * 2);
        context.fill();
      }
    }

    function handlePointerMove(eventArg: ReactPointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current || disabled) return;
      eventArg.preventDefault();

      const canvas = canvasRef.current;
      const lastPoint = lastPointRef.current;
      if (!canvas || !lastPoint) return;

      const next = getPointerPosition(eventArg);
      if (!next) return;

      const context = canvas.getContext("2d");
      if (!context) return;

      context.strokeStyle = "#101c30";
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 2.4;
      context.beginPath();
      context.moveTo(lastPoint.x, lastPoint.y);
      context.lineTo(next.x, next.y);
      context.stroke();

      lastPointRef.current = next;
      reportChange(true);
    }

    function handlePointerUp(eventArg: ReactPointerEvent<HTMLCanvasElement>) {
      if (!drawingRef.current) return;

      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(eventArg.pointerId)) {
        canvas.releasePointerCapture(eventArg.pointerId);
      }

      drawingRef.current = false;
      lastPointRef.current = null;
    }

    function handleClear() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("2d");
      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      paintBackground(context, canvas.width, canvas.height);
      reportChange(false);
      setShowInitialPreview(false);
      onClear?.();
    }

    return (
      <div className="signature-pad" ref={containerRef}>
        <div className="signature-pad__surface">
          {showInitialPreview && initialDataUrl ? (
            <img
              alt="Firma esistente"
              className="signature-pad__preview"
              src={initialDataUrl}
            />
          ) : null}
          <canvas
            aria-label="Riquadro per firma"
            className="signature-pad__canvas"
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerLeave={handlePointerUp}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            ref={canvasRef}
          />
        </div>
        <div className="signature-pad__hint">
          <small>
            {showInitialPreview
              ? "Firma gia presente. Tocca o disegna sopra per sostituirla."
              : "Firma con il dito (telefono) o con il mouse (computer)."}
          </small>
          <button
            className="button button--ghost button--small"
            disabled={disabled}
            onClick={handleClear}
            type="button"
          >
            <AppIcon name="trash" />
            <span>Cancella</span>
          </button>
        </div>
      </div>
    );
  },
);

async function resolveSignatureBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const context = canvas.getContext("2d");

  if (!context || canvas.width <= 0 || canvas.height <= 0) {
    return null;
  }

  const source = context.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let index = 0; index < source.data.length; index += 4) {
    const red = source.data[index];
    const green = source.data[index + 1];
    const blue = source.data[index + 2];
    const isWhite = red > 242 && green > 242 && blue > 242;

    if (isWhite) {
      source.data[index + 3] = 0;
      continue;
    }

    const pixel = index / 4;
    const x = pixel % canvas.width;
    const y = Math.floor(pixel / canvas.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  const padding = 18;
  const left = Math.max(0, minX - padding);
  const top = Math.max(0, minY - padding);
  const right = Math.min(canvas.width - 1, maxX + padding);
  const bottom = Math.min(canvas.height - 1, maxY + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");

  if (!outputContext) {
    return null;
  }

  const transparent = document.createElement("canvas");
  transparent.width = canvas.width;
  transparent.height = canvas.height;
  const transparentContext = transparent.getContext("2d");

  if (!transparentContext) {
    return null;
  }

  transparentContext.putImageData(source, 0, 0);
  outputContext.drawImage(
    transparent,
    left,
    top,
    width,
    height,
    0,
    0,
    width,
    height,
  );

  return new Promise((resolve) => {
    output.toBlob((blob) => resolve(blob), "image/png");
  });
}
