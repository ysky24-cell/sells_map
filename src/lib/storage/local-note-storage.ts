import { promises as fs } from "fs";
import path from "path";
import type { StorageService } from "@/types/domain";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const STORAGE_DIR = path.join(PUBLIC_ROOT, "mock-storage", "notes");

function extensionFromMimeType(mimeType: "image/png" | "image/svg+xml") {
  return mimeType === "image/svg+xml" ? "svg" : "png";
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL");
  }

  return Buffer.from(match[2], "base64");
}

export class LocalNoteStorageService implements StorageService {
  async saveNoteImage(params: {
    noteId: string;
    locationId: string;
    dataUrl: string;
    mimeType: "image/png" | "image/svg+xml";
  }) {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    const extension = extensionFromMimeType(params.mimeType);
    const fileName = `${params.locationId}-${params.noteId}.${extension}`;
    const absolutePath = path.join(STORAGE_DIR, fileName);

    await fs.writeFile(absolutePath, decodeDataUrl(params.dataUrl));

    const key = `mock-storage/notes/${fileName}`;
    return { key, url: this.getPublicUrl(key) };
  }

  getPublicUrl(key: string) {
    return `/${key.replaceAll("\\", "/")}`;
  }
}

export const noteStorageService = new LocalNoteStorageService();
