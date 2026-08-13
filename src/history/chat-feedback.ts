import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type FeedbackRating = 'up' | 'down';

export interface FeedbackSource {
  file: string;
  section: string;
  score: number;
}

export interface FeedbackRecord {
  id: string;
  project: string;
  createdAt: string;
  query: string;
  answer: string;
  rating: FeedbackRating;
  sources: FeedbackSource[];
}

export type NewFeedbackRecord = Omit<FeedbackRecord, 'id' | 'createdAt'>;

// ponytail: whole-file rewrite of a capped array, same tradeoff as SyncHistoryStore — a few
// hundred ratings at human chat rates. Swap for append-only JSONL if this ever gets hot.
const MAX_RECORDS = 500;

/** Persists 👍/👎 ratings on chat answers, so which queries the RAG pipeline is failing on is
 *  reviewable across sessions/devices instead of living only in one browser's memory. */
export class ChatFeedbackStore {
  constructor(private readonly filePath: string) {}

  append(record: NewFeedbackRecord): FeedbackRecord {
    const stored: FeedbackRecord = { id: `${Date.now()}-${randomSuffix()}`, createdAt: new Date().toISOString(), ...record };
    const all = [stored, ...this.load()].slice(0, MAX_RECORDS);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(all, null, 2) + '\n', 'utf8');
    return stored;
  }

  /** Newest first. Omit `project` for the cross-project feed. */
  list(options: { project?: string; limit?: number } = {}): FeedbackRecord[] {
    const limit = options.limit ?? 50;
    return this.load()
      .filter((r) => (options.project ? r.project === options.project : true))
      .slice(0, limit);
  }

  private load(): FeedbackRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed) ? (parsed as FeedbackRecord[]) : [];
    } catch {
      // A corrupt feedback file must never break the chat endpoint — this is observability data.
      return [];
    }
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
