import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { noteStorageService } from "@/lib/storage/local-note-storage";
import type {
  HandwrittenNote,
  HandwrittenNoteInput,
  HandwrittenNoteRepository,
  StorageService,
} from "@/types/domain";

const DATA_PATH = path.join(process.cwd(), "data", "notes.json");

async function readAllNotes(): Promise<HandwrittenNote[]> {
  const raw = await fs.readFile(DATA_PATH, "utf8");
  return JSON.parse(raw) as HandwrittenNote[];
}

async function writeAllNotes(notes: HandwrittenNote[]) {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

export class JsonHandwrittenNoteRepository
  implements HandwrittenNoteRepository
{
  constructor(private readonly storage: StorageService) {}

  async listByLocation(locationId: string) {
    const notes = await readAllNotes();
    return notes
      .filter((note) => note.locationId === locationId && !note.deletedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(noteId: string) {
    const notes = await readAllNotes();
    return notes.find((note) => note.noteId === noteId && !note.deletedAt) ?? null;
  }

  async create(input: HandwrittenNoteInput) {
    const notes = await readAllNotes();
    const now = new Date().toISOString();
    const noteId = `note-${randomUUID()}`;
    const saved = await this.storage.saveNoteImage({
      noteId,
      locationId: input.locationId,
      dataUrl: input.dataUrl,
      mimeType: input.mimeType,
    });

    const note: HandwrittenNote = {
      noteId,
      locationId: input.locationId,
      userId: input.userId,
      s3Key: saved.key,
      mimeType: input.mimeType,
      title: input.title?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    notes.push(note);
    await writeAllNotes(notes);
    return note;
  }

  async softDelete(noteId: string, actorUserId: string) {
    void actorUserId;
    const notes = await readAllNotes();
    const index = notes.findIndex((note) => note.noteId === noteId && !note.deletedAt);

    if (index === -1) {
      throw new Error("Note not found");
    }

    const now = new Date().toISOString();
    const note: HandwrittenNote = {
      ...notes[index],
      updatedAt: now,
      deletedAt: now,
    };

    notes[index] = note;
    await writeAllNotes(notes);
    return note;
  }
}

export const handwrittenNoteRepository = new JsonHandwrittenNoteRepository(
  noteStorageService,
);
