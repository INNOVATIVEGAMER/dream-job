import type { DatabaseSync } from 'node:sqlite'

import type { ChatItem, ChatSummary } from '../../shared/types'
import { now } from './database'

type ItemRow = { id: number; kind: ChatItem['kind']; text: string; at: string; isError: number }

type KeptChat = ChatSummary & { inputTokens: number; outputTokens: number; model: string | null }

const toItem = (row: ItemRow): ChatItem => ({ id: String(row.id), kind: row.kind, text: row.text, at: row.at, isError: row.isError === 1 })

/** Chats with Claude, each with every line it holds, newest chat first. */
export class Chats {
  constructor(private readonly db: DatabaseSync) {}

  /** A new chat; `model` null follows the default in Settings. */
  create(title: string, model: string | null): number {
    const at = now()
    return Number(this.db.prepare('INSERT INTO chats (title, created, updated, model) VALUES (?, ?, ?, ?)').run(title, at, at, model).lastInsertRowid)
  }

  get(id: number): KeptChat | null {
    const row = this.db.prepare('SELECT id, title, updated, input_tokens AS inputTokens, output_tokens AS outputTokens, model FROM chats WHERE id = ?').get(id)
    return row ? ({ ...row } as KeptChat) : null
  }

  setModel(chatId: number, model: string | null): void {
    this.db.prepare('UPDATE chats SET model = ? WHERE id = ?').run(model, chatId)
  }

  list(limit = 50): ChatSummary[] {
    return this.db
      .prepare('SELECT id, title, updated FROM chats ORDER BY updated DESC, id DESC LIMIT ?')
      .all(limit)
      .map(row => ({ ...row }) as ChatSummary)
  }

  items(chatId: number): ChatItem[] {
    return this.db
      .prepare('SELECT id, kind, text, at, is_error AS isError FROM chat_items WHERE chat_id = ? ORDER BY id')
      .all(chatId)
      .map(row => toItem({ ...row } as ItemRow))
  }

  addItem(chatId: number, kind: ChatItem['kind'], text: string, isError = false): ChatItem {
    const at = now()
    const id = Number(this.db.prepare('INSERT INTO chat_items (chat_id, at, kind, text, is_error) VALUES (?, ?, ?, ?, ?)').run(chatId, at, kind, text, isError ? 1 : 0).lastInsertRowid)
    this.db.prepare('UPDATE chats SET updated = ? WHERE id = ?').run(at, chatId)
    return { id: String(id), kind, text, at, isError }
  }

  updateItem(itemId: string, text: string, isError: boolean): void {
    this.db.prepare('UPDATE chat_items SET text = ?, is_error = ? WHERE id = ?').run(text, isError ? 1 : 0, Number(itemId))
  }

  addUsage(chatId: number, inputTokens: number, outputTokens: number): void {
    this.db.prepare('UPDATE chats SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?').run(inputTokens, outputTokens, chatId)
  }

  remove(chatId: number): void {
    this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId)
  }
}
