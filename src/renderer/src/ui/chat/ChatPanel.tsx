import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'

import { ArrowUpIcon, BrowserIcon, CaretDownIcon, ClockCounterClockwiseIcon, PlusIcon, SparkleIcon, StopIcon, TrashIcon, WarningCircleIcon, WrenchIcon, XIcon } from '@phosphor-icons/react'

import type { ChatItem, ChatState, ChatSummary, ClaudeModel } from '../../../../shared/types'
import { api } from '../../lib/api'
import { when } from '../../lib/format'
import { isLatest, modelLabel, modelName } from '../../lib/models'
import { useAppStatus } from '../../lib/status'
import { RunCardView } from '../../screens/run/Cards'
import type { CardActions } from '../../screens/run/Cards'
import { attempt } from '../common'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Spinner,
  Textarea,
} from '../nx'

const EMPTY: ChatState = { id: null, title: '', items: [], isBusy: false, card: null, usage: { inputTokens: 0, outputTokens: 0 }, model: 'default', followsDefault: true }

/** The radio value for "follow the default in Settings". */
const FOLLOW = '__settings__'

/** The open chat, kept current from the main process. */
export function useChat(): ChatState {
  const [state, setState] = useState<ChatState>(EMPTY)
  useEffect(() => {
    let isLive = true
    void api.chat.state().then(first => isLive && setState(first))
    const off = api.chat.onState(setState)
    return () => {
      isLive = false
      off()
    }
  }, [])
  return state
}

/** The chat's cards answer the chat, and show the chat's own tab. */
const CHAT_ACTIONS: CardActions = {
  answer: (card, reply) => attempt(() => api.chat.answer(card.id, reply)),
  showTab: () => attempt(() => api.chat.showTab()),
}

const SUGGESTIONS = ['What needs me today?', 'Summarize where my applications stand', 'Which applied companies have nobody to ask?']

/** The screen the user is on, as a path: what "this job" means to Claude. */
const route = (): string => window.location.hash.replace(/^#/, '') || '/'

function Line({ item }: { item: ChatItem }): JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="nx:self-end nx:max-w-[85%] nx:rounded-lg nx:px-3 nx:py-2 nx:bg-secondary-background nx:text-secondary-foreground nx:typography-body-default nx:whitespace-pre-wrap nx:break-words">
          {item.text}
        </div>
      )
    case 'assistant':
      return <div className="nx:typography-body-default nx:whitespace-pre-wrap nx:break-words">{item.text}</div>
    case 'tool':
      return (
        <div className={`nx:flex nx:items-start nx:gap-1.5 nx:typography-body-small ${item.isError ? 'nx:text-error-subtle-foreground' : 'nx:text-muted-foreground'}`}>
          <span className="nx:mt-0.5 nx:shrink-0">{item.isError ? <WarningCircleIcon size={12} /> : <WrenchIcon size={12} />}</span>
          <span className="nx:break-words nx:min-w-0">{item.text}</span>
        </div>
      )
    case 'note':
      return <div className={`nx:typography-body-small ${item.isError ? 'nx:text-error-subtle-foreground' : 'nx:text-muted-foreground'}`}>{item.text}</div>
  }
}

function History({ chat }: { chat: ChatState }): JSX.Element {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  return (
    <DropdownMenu onOpenChange={isOpen => isOpen && void api.chat.list().then(setChats)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Past chats" title="Past chats">
          <ClockCounterClockwiseIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="nx:max-h-[420px] nx:overflow-y-auto nx:w-[300px]">
        <DropdownMenuLabel>Past chats</DropdownMenuLabel>
        {chats?.length === 0 && <DropdownMenuItem disabled>No chats yet</DropdownMenuItem>}
        {chats?.map(one => (
          <DropdownMenuItem key={one.id} onSelect={() => void attempt(() => api.chat.open(one.id))}>
            <div className="nx:flex nx:flex-col nx:min-w-0">
              <span className={`nx:truncate ${one.id === chat.id ? 'nx:typography-label-default' : ''}`}>{one.title}</span>
              <span className="nx:typography-body-small nx:text-muted-foreground">{when(one.updated)}</span>
            </div>
          </DropdownMenuItem>
        ))}
        {chat.id !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void attempt(() => api.chat.remove(chat.id!))}>
              <TrashIcon />
              Delete this chat
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModelItem({ model, models }: { model: ClaudeModel; models: ClaudeModel[] }): JSX.Element {
  return (
    <DropdownMenuRadioItem value={model.value}>
      <div className="nx:flex nx:flex-col nx:min-w-0">
        <span className="nx:truncate">{modelLabel(model, models)}</span>
        <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">{model.description}</span>
      </div>
    </DropdownMenuRadioItem>
  )
}

/** The model for this chat, beside the message box: the default from Settings, or one picked for this chat. */
function ModelPicker({ chat }: { chat: ChatState }): JSX.Element {
  const models = useAppStatus()?.claude.models ?? []
  const latest = models.filter(isLatest)
  const older = models.filter(model => !isLatest(model))
  const settingsDefault = useSettingsModel()
  const pick = (value: string): void => void attempt(() => api.chat.setModel(value === FOLLOW ? null : value))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" endIcon={<CaretDownIcon />} disabled={chat.isBusy} title={chat.followsDefault ? 'The default from Settings' : 'Picked for this chat'}>
          {modelName(chat.model, models)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="nx:w-[300px]">
        <DropdownMenuLabel>Model for this chat</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={chat.followsDefault ? FOLLOW : chat.model} onValueChange={pick}>
          <DropdownMenuRadioItem value={FOLLOW}>
            <div className="nx:flex nx:flex-col nx:min-w-0">
              <span className="nx:truncate">Settings default · {modelName(settingsDefault, models)}</span>
              <span className="nx:typography-body-small nx:text-muted-foreground nx:truncate">Follows Settings, Accounts</span>
            </div>
          </DropdownMenuRadioItem>
          {latest.length > 0 && <DropdownMenuSeparator />}
          {latest.map(model => (
            <ModelItem key={model.value} model={model} models={models} />
          ))}
          {older.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More models</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="nx:w-[280px]">
                {older.map(model => (
                  <ModelItem key={model.value} model={model} models={models} />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The default model in Settings, kept current. */
function useSettingsModel(): string {
  const [model, setModel] = useState('default')
  useEffect(() => {
    let isLive = true
    const load = (): void => void api.settings.get().then(settings => isLive && setModel(settings.model))
    load()
    const off = api.onData(topics => topics.includes('settings') && load())
    return () => {
      isLive = false
      off()
    }
  }, [])
  return model
}

/**
 * Claude, beside every screen: ask about the search, change the tracker,
 * start runs and work in Chrome. Cards that need you show at the bottom.
 */
export function ChatPanel({ chat, onClose }: { chat: ChatState; onClose: () => void }): JSX.Element {
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const last = chat.items[chat.items.length - 1]
  const isThinking = chat.isBusy && !chat.card && last?.kind !== 'assistant'

  useEffect(() => input.current?.focus(), [])

  // Follows the newest line, unless the user scrolled up to read.
  const isFollowing = useRef(true)
  useEffect(() => {
    const box = list.current
    if (box && isFollowing.current) box.scrollTop = box.scrollHeight
  }, [chat.items, chat.card, isThinking])

  const send = async (text: string): Promise<void> => {
    if (!text.trim() || chat.isBusy) return
    setDraft('')
    isFollowing.current = true
    const sent = await attempt(() => api.chat.send(text, route()).then(() => true))
    if (!sent) setDraft(text)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(draft)
    }
  }

  return (
    <aside aria-label="Chat with Claude" className="nx:sticky nx:top-0 nx:h-svh nx:w-[400px] nx:shrink-0 nx:box-border nx:flex nx:flex-col nx:border-l-default nx:border-border-default nx:bg-background">
      <header className="nx:flex nx:items-center nx:gap-2 nx:min-h-12 nx:box-border nx:px-3 nx:py-2 nx:border-b-default nx:border-border-default">
        <SparkleIcon size={16} className="nx:shrink-0" />
        <span className="nx:flex-1 nx:min-w-0 nx:truncate nx:typography-label-default">{chat.title || 'Claude'}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Show the chat's Chrome tab" title="Show the chat's Chrome tab" onClick={() => void attempt(() => api.chat.showTab())}>
          <BrowserIcon />
        </Button>
        <History chat={chat} />
        <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={() => void attempt(() => api.chat.startNew())}>
          <PlusIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close the chat" title="Close (⌘J)" onClick={onClose}>
          <XIcon />
        </Button>
      </header>

      <div
        ref={list}
        className="nx:flex-1 nx:min-h-0 nx:overflow-y-auto nx:px-4 nx:py-4 nx:flex nx:flex-col nx:gap-3"
        onScroll={event => {
          const box = event.currentTarget
          isFollowing.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
        }}
      >
        {chat.items.length === 0 ? (
          <div className="nx:flex nx:flex-col nx:gap-3 nx:mt-auto">
            <p className="nx:m-0 nx:typography-body-default nx:text-muted-foreground">
              Ask about your search, or tell Claude what to change. It works through the app: your tracker, runs, settings, and its own tab in Chrome. Anything that sends waits for you.
            </p>
            <div className="nx:flex nx:flex-col nx:items-start nx:gap-1.5">
              {SUGGESTIONS.map(text => (
                <Button key={text} variant="outline" size="sm" onClick={() => void send(text)}>
                  {text}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          chat.items.map(item => <Line key={item.id} item={item} />)
        )}
        {isThinking && (
          <div className="nx:flex nx:items-center nx:gap-2 nx:typography-body-small nx:text-muted-foreground">
            <Spinner />
            Working...
          </div>
        )}
        {chat.card && <RunCardView card={chat.card} actions={CHAT_ACTIONS} />}
      </div>

      <div className="nx:box-border nx:px-3 nx:pt-2 nx:pb-3 nx:border-t-default nx:border-border-default nx:flex nx:flex-col nx:gap-2">
        <Textarea
          ref={input}
          rows={Math.min(8, Math.max(2, draft.split('\n').length))}
          placeholder={chat.isBusy ? 'Claude is working...' : 'Ask Claude, or tell it what to do. Shift+Enter for a new line'}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onKey}
          aria-label="Message to Claude"
        />
        <div className="nx:flex nx:items-center nx:justify-between nx:gap-2">
          <ModelPicker chat={chat} />
          {chat.isBusy ? (
            <Button size="sm" variant="outline" startIcon={<StopIcon />} onClick={() => void attempt(() => api.chat.stop())}>
              Stop
            </Button>
          ) : (
            <Button size="sm" startIcon={<ArrowUpIcon />} disabled={!draft.trim()} onClick={() => void send(draft)}>
              Send
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
