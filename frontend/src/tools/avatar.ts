import { t } from "@/lang/i18n";

const ACCEPTED = ["image/png", "image/webp", "image/jpeg"];
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8 MB raw input cap

/**
 * Read an image File, center-crop to a square, resize to `size`x`size`, and
 * return a small base64 data URL (webp). Throws a localized error on bad input.
 */
export function fileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  if (!ACCEPTED.includes(file.type)) return Promise.reject(new Error(t("TXT_CODE_avatar.badType")));
  if (file.size > MAX_INPUT_BYTES) return Promise.reject(new Error(t("TXT_CODE_avatar.tooLarge")));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error(t("TXT_CODE_avatar.badType")));
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      let dataUrl = canvas.toDataURL("image/webp", 0.9);
      if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("TXT_CODE_avatar.badType")));
    };
    img.src = url;
  });
}
