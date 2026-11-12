import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'

/** One event Chrome sends without being asked: a method, its params, and the session it came from. */
export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string }

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }

/**
 * A minimal Chrome DevTools Protocol client over `--remote-debugging-pipe`:
 * Chrome reads commands on its fd 3 and writes answers and events on fd 4,
 * each message JSON ending in a NUL byte. Nothing listens on a network port.
 */
export class Cdp extends EventEmitter<{ event: [CdpEvent]; closed: [] }> {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private buffer = ''
  private isClosed = false

  constructor(
    private readonly toChrome: Writable,
    fromChrome: Readable,
  ) {
    super()
    fromChrome.setEncoding('utf8')
    fromChrome.on('data', (chunk: string) => this.receive(chunk))
    fromChrome.on('close', () => this.close())
    toChrome.on('error', () => this.close())
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.isClosed) return Promise.reject(new Error('Chrome is not connected'))
    const id = this.nextId++
    const message = sessionId ? { id, method, params, sessionId } : { id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.toChrome.write(`${JSON.stringify(message)}\0`)
    })
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let end = this.buffer.indexOf('\0')
    while (end !== -1) {
      const text = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      this.handle(text)
      end = this.buffer.indexOf('\0')
    }
  }

  private handle(text: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (typeof message.id === 'number') {
      const waiting = this.pending.get(message.id)
      if (!waiting) return
      this.pending.delete(message.id)
      const error = message.error as { message?: string } | undefined
      if (error) waiting.reject(new Error(error.message ?? 'Chrome refused the command'))
      else waiting.resolve((message.result as Record<string, unknown>) ?? {})
    } else if (typeof message.method === 'string') {
      this.emit('event', {
        method: message.method,
        params: (message.params as Record<string, unknown>) ?? {},
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
      })
    }
  }

  private close(): void {
    if (this.isClosed) return
    this.isClosed = true
    for (const waiting of this.pending.values()) waiting.reject(new Error('Chrome closed'))
    this.pending.clear()
    this.emit('closed')
  }
}
