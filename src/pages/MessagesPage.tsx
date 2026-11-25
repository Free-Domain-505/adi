import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ExternalLink,
  Loader2,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneOff,
  Search,
  Send,
  Sparkles,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useVoiceCall } from '../context/VoiceCallContext'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'
import { StyledDisplayName } from '../components/StyledDisplayName'
import {
  fetchConversations,
  fetchMessagesWith,
  findUserByHandle,
  searchUsersByQuery,
  sendDirectMessage,
  markConversationAsRead,
  parseCallMessage,
  formatCallDuration,
  formatCallSummary,
  formatCallTimer,
  type ConversationSummary,
  type DirectMessage,
  type PartnerProfile,
} from '../lib/messages'
import { supabase } from '../lib/supabase'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'
import { requestMicrophoneStream } from '../lib/microphone'

const ICEBREAKERS = [
  'Hey! Watching anything good lately?',
  'Got any manhwa or anime recommendations?',
  'Up for a watch party sometime?',
]

function timeLabel(dateString: string) {
  const d = new Date(dateString)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function shortDateLabel(dateString: string) {
  const d = new Date(dateString)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return timeLabel(dateString)
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function dateDividerLabel(dateString: string) {
  const d = new Date(dateString)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

export default function MessagesPage() {
  const { partnerHandle } = useParams<{ partnerHandle?: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { startCall, activeCall } = useVoiceCall()
  const [liveCallSeconds, setLiveCallSeconds] = useState(0)

  useEffect(() => {
    if (!activeCall || activeCall.status === 'ended' || activeCall.status === 'idle') {
      setLiveCallSeconds(0)
      return
    }

    setLiveCallSeconds(activeCall.getDuration())
    const interval = window.setInterval(() => {
      setLiveCallSeconds(activeCall.getDuration())
    }, 1000)

    return () => clearInterval(interval)
  }, [activeCall, activeCall?.status])

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [directoryMatches, setDirectoryMatches] = useState<PartnerProfile[]>([])
  const [searchingDirectory, setSearchingDirectory] = useState(false)

  // Active chat state
  const [activePartner, setActivePartner] = useState<PartnerProfile | null>(null)
  const [partnerNotFound, setPartnerNotFound] = useState(false)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendTick, setSendTick] = useState(0)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const keyOf = useRef(new Map<string, string>())
  const seen = useRef(new Set<string>())

  const scrollToBottom = (smooth = false) => {
    const el = messagesContainerRef.current
    if (!el) return
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }

  const reloadConversations = async () => {
    if (!user?.id) return
    try {
      const convs = await fetchConversations(user.id)
      setConversations(convs)
    } finally {
      setLoadingConvs(false)
    }
  }

  useEffect(() => {
    document.title = 'Messages — AnimeStream'
    if (user?.id) {
      void reloadConversations()
    } else {
      setLoadingConvs(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) {
      setDirectoryMatches([])
      setSearchingDirectory(false)
      return
    }
    const q = searchQuery.trim().replace(/^@/, '')
    if (q.length < 2) {
      setDirectoryMatches([])
      setSearchingDirectory(false)
      return
    }
    let alive = true
    setSearchingDirectory(true)
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchUsersByQuery(q, user.id)
        if (alive) setDirectoryMatches(rows)
      } finally {
        if (alive) setSearchingDirectory(false)
      }
    }, 240)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [searchQuery, user?.id])

  useEffect(() => {
    if (!partnerHandle || !user?.id) {
      setActivePartner(null)
      setPartnerNotFound(false)
      setMessages([])
      return
    }

    let alive = true
    setLoadingMessages(true)
    setPartnerNotFound(false)

    findUserByHandle(partnerHandle).then(async (partner) => {
      if (!alive) return
      if (!partner) {
        setPartnerNotFound(true)
        setLoadingMessages(false)
        return
      }

      setActivePartner(partner)
      document.title = `${partner.displayName} (@${partner.username}) — Messages · AnimeStream`

      try {
        const msgs = await fetchMessagesWith(user.id, partner.id)
        if (alive) {
          keyOf.current.clear()
          seen.current = new Set(msgs.map((m) => m.id))
          setMessages(msgs)
          void markConversationAsRead(user.id, partner.id)
          setConversations((list) =>
            list.map((item) => (item.partnerId === partner.id ? { ...item, unreadCount: 0 } : item)),
          )
          setTimeout(() => scrollToBottom(), 50)
        }
      } finally {
        if (alive) setLoadingMessages(false)
      }
    })

    return () => {
      alive = false
    }
  }, [partnerHandle, user?.id])

  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`dm_messages_page:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as DirectMessage

            if (
              activePartner &&
              (newMsg.sender_id === activePartner.id || newMsg.receiver_id === activePartner.id)
            ) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev
                return [...prev, newMsg]
              })
              setTimeout(() => scrollToBottom(true), 40)
              if (user.id === newMsg.receiver_id) void markConversationAsRead(user.id, newMsg.sender_id)
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as DirectMessage
            if (
              activePartner &&
              (updatedMsg.sender_id === activePartner.id || updatedMsg.receiver_id === activePartner.id)
            ) {
              setMessages((prev) => prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m)))
            }
          }

          void reloadConversations()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, activePartner?.id])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])

  const sendText = async (rawContent: string) => {
    if (!user?.id || !activePartner?.id) return
    const content = rawContent.trim()
    if (!content || sending) return

    setSending(true)
    const tempId = `temp-${Date.now()}`
    const optimistic: DirectMessage = {
      id: tempId,
      sender_id: user.id,
      receiver_id: activePartner.id,
      content,
      read: false,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimistic])
    setSendTick((n) => n + 1)
    setText('')
    setTimeout(() => scrollToBottom(true), 30)

    try {
      const real = await sendDirectMessage(user.id, activePartner.id, content)
      if (real) {
        keyOf.current.set(real.id, tempId)
        setMessages((prev) =>
          prev.some((m) => m.id === real.id)
            ? prev.filter((m) => m.id !== tempId)
            : prev.map((m) => (m.id === tempId ? real : m)),
        )
        void reloadConversations()
      }
    } catch {
      toast('Failed to send message', 'error')
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setText(content)
    } finally {
      setSending(false)
    }
  }

  const handleSend = () => sendText(text)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const startPartnerCall = async () => {
    if (!activePartner) return
    let stream: MediaStream | undefined
    try {
      stream = await requestMicrophoneStream()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('HTTPS')) {
        toast(msg, 'error')
        return
      }
    }
    await startCall(
      {
        id: activePartner.id,
        username: activePartner.username,
        displayName: activePartner.displayName,
        avatar: activePartner.avatarUrl,
        nameStyle: activePartner.nameStyle ?? null,
      },
      stream,
    )
    navigate('/call')
  }

  if (!user) {
    return (
      <main className="fixed inset-0 z-20 flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card px-4 sm:px-6">
          <Link
            to="/home"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted transition hover:text-foreground active:scale-95"
          >
            <ArrowLeft className="size-4" />
            <span>Back to AnimeStream</span>
          </Link>
          <Logo size={32} textClassName="hidden sm:inline" />
        </header>
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-lg rounded-3xl border border-border/80 bg-card p-8 text-center shadow-2xl sm:p-14">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-accent/30 bg-accent/15 text-accent">
              <MessageSquare className="size-8" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">Direct Messages</h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              Sign in with your AnimeStream account to message friends, share series recommendations, and start audio calls.
            </p>
            <div className="mt-7 flex justify-center">
              <Link
                to="/login"
                className="inline-flex h-12 items-center gap-2.5 rounded-2xl bg-accent px-7 text-sm font-bold text-accent-fg shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-95"
              >
                <span>Sign in or Register</span>
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const cleanSearch = searchQuery.trim().replace(/^@/, '')
  const filteredConversations = conversations.filter((c) => {
    if (!cleanSearch) return true
    const q = cleanSearch.toLowerCase()
    return (
      c.partnerDisplayName.toLowerCase().includes(q) ||
      c.partnerUsername.toLowerCase().includes(q) ||
      c.lastMessage.toLowerCase().includes(q)
    )
  })
  const unreadTotal = conversations.reduce((n, c) => n + c.unreadCount, 0)
  const canJumpHandle =
    cleanSearch.length >= 2 &&
    /^[a-zA-Z0-9_.-]+$/.test(cleanSearch) &&
    !conversations.some((c) => c.partnerUsername.toLowerCase() === cleanSearch.toLowerCase())

  return (
    <main className="fixed inset-0 z-20 flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      <div className="relative flex min-h-0 w-full flex-1 overflow-hidden md:grid md:grid-cols-[21.5rem_minmax(0,1fr)]">
        {/* ================= LEFT PANE: Inbox & Conversations List ================= */}
        <aside
          className={cn(
            'flex w-full flex-col border-r border-border/70 bg-card md:w-auto',
            partnerHandle ? 'hidden md:flex' : 'flex',
          )}
        >
          {/* Inbox Header */}
          <div className="shrink-0 border-b border-border/70 bg-card/75 px-4 pb-3.5 pt-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Link
                  to="/home"
                  aria-label="Back to AnimeStream home"
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/80 bg-card-2/80 text-foreground transition hover:border-accent/60 hover:text-accent active:scale-95"
                >
                  <ArrowLeft className="size-4" />
                </Link>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="font-display text-base font-bold tracking-tight text-foreground">Messages</h1>
                    {unreadTotal > 0 && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-fg">
                        {unreadTotal}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">
                    {conversations.length === 0
                      ? 'Direct inbox'
                      : `${conversations.length} conversation${conversations.length === 1 ? '' : 's'}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Link
                  to="/community"
                  title="Browse Community"
                  aria-label="Browse Community"
                  className="grid size-9 place-items-center rounded-xl border border-border/80 bg-card-2/70 text-muted transition hover:border-accent/60 hover:text-accent"
                >
                  <Users className="size-4" />
                </Link>
                <Logo size={28} showText={false} className="ml-0.5" />
              </div>
            </div>

            {/* Search or open @handle */}
            <form
              className="relative mt-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (canJumpHandle) {
                  navigate(`/messages/${cleanSearch}`)
                  setSearchQuery('')
                }
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats or enter @handle…"
                className="h-9.5 w-full rounded-xl border border-border/80 bg-card-2/90 pl-9 pr-8 text-xs font-medium text-foreground outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </form>

            {canJumpHandle && (
              <button
                type="button"
                onClick={() => {
                  navigate(`/messages/${cleanSearch}`)
                  setSearchQuery('')
                }}
                className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-accent/35 bg-accent/10 px-3 py-2 text-left text-xs font-semibold text-accent transition hover:bg-accent/15 active:scale-[0.99]"
              >
                <span className="flex items-center gap-2 truncate">
                  <UserPlus className="size-3.5 shrink-0" />
                  <span className="truncate">Message @{cleanSearch}</span>
                </span>
                <span className="text-[10px] uppercase tracking-wider opacity-80">Open</span>
              </button>
            )}
          </div>

          {/* Conversations Scrollable List */}
          <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain p-2.5">
            {loadingConvs ? (
              <div className="my-auto flex items-center justify-center gap-2 p-8 text-xs text-muted">
                <Loader2 className="size-4 animate-spin text-accent" />
                <span>Loading conversations…</span>
              </div>
            ) : filteredConversations.length === 0 && (!cleanSearch || (!searchingDirectory && directoryMatches.length === 0)) ? (
              <div className="my-auto px-3 py-8">
                <div className="rounded-2xl border border-border/70 bg-card/70 p-6 text-center shadow-sm">
                  <div className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-card-2 text-muted">
                    <MessageSquare className="size-5" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {cleanSearch ? 'No matching chats or users' : 'No conversations yet'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {cleanSearch
                      ? 'Press Enter to open a chat directly by @handle, or clear your search.'
                      : 'Visit any member profile in Community and select Message to start chatting.'}
                  </p>
                  {!cleanSearch && (
                    <Link
                      to="/community"
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-bold text-accent-fg transition hover:brightness-110 active:scale-95"
                    >
                      <Users className="size-3.5" />
                      Explore Community
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredConversations.length > 0 && (
                  <div className="space-y-1">
                    {filteredConversations.map((c) => {
                      const isSelected = activePartner?.id === c.partnerId
                      const preview = formatCallSummary(c.lastMessage, c.lastMessageAt)
                      return (
                        <button
                          key={c.partnerId}
                          type="button"
                          onClick={() => navigate(`/messages/${c.partnerUsername}`)}
                          className={cn(
                            'group relative flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition active:scale-[0.99]',
                            isSelected
                              ? 'border-accent/40 bg-accent/12 text-foreground shadow-sm'
                              : 'border-transparent text-muted hover:border-border/60 hover:bg-card-2/70 hover:text-foreground',
                          )}
                        >
                          {isSelected && (
                            <span className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-accent" />
                          )}
                          <div className="relative shrink-0">
                            <Avatar
                              size={44}
                              name={c.partnerDisplayName}
                              src={c.partnerAvatar}
                              frame={c.partnerFrame}
                              animateFrame={false}
                            />
                            {c.unreadCount > 0 && (
                              <span className="absolute -right-1 -top-1 flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 py-0.5 text-[10px] font-bold leading-none text-accent-fg shadow-sm">
                                {c.unreadCount}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <StyledDisplayName
                                  name={c.partnerDisplayName}
                                  styleSpec={c.partnerNameStyle}
                                  userId={c.partnerId}
                                  className="truncate text-xs font-bold text-foreground sm:text-sm"
                                />
                                <span className="shrink-0 font-mono text-[10px] font-medium text-muted">
                                  @{c.partnerUsername}
                                </span>
                              </span>
                              <span className="shrink-0 text-[10px] font-medium text-muted">
                                {shortDateLabel(c.lastMessageAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p
                                className={cn(
                                  'truncate text-xs',
                                  c.unreadCount > 0 ? 'font-semibold text-foreground' : 'text-muted',
                                )}
                              >
                                {preview}
                              </p>
                              {c.unreadCount > 0 && <span className="size-2 shrink-0 rounded-full bg-accent" />}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {cleanSearch.length >= 2 && (searchingDirectory || directoryMatches.length > 0) && (
                  <div className="space-y-1 border-t border-border/50 pt-2.5">
                    <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {searchingDirectory ? 'Searching members…' : 'Members'}
                    </p>
                    {directoryMatches
                      .filter((m) => !filteredConversations.some((c) => c.partnerId === m.id))
                      .map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            navigate(`/messages/${m.username}`)
                            setSearchQuery('')
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl border border-transparent p-2 text-left transition hover:border-border/60 hover:bg-card-2/70 active:scale-[0.99]"
                        >
                          <Avatar
                            size={36}
                            name={m.displayName}
                            src={m.avatarUrl}
                            frame={m.frame}
                            animateFrame={false}
                          />
                          <div className="min-w-0 flex-1">
                            <StyledDisplayName
                              as="p"
                              name={m.displayName}
                              styleSpec={m.nameStyle}
                              userId={m.id}
                              className="truncate text-xs font-bold text-foreground"
                            />
                            <p className="truncate font-mono text-[11px] text-accent">@{m.username}</p>
                          </div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Chat</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* ================= RIGHT PANE: Active Chat View ================= */}
        <section
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col bg-background',
            !partnerHandle ? 'hidden md:flex' : 'flex',
          )}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-card/35 via-background to-background"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-56 w-[32rem] -translate-x-1/2 rounded-full bg-accent/[0.05] blur-3xl"
          />

          {partnerNotFound ? (
            <div className="relative z-10 m-auto w-full max-w-sm p-6">
              <div className="rounded-3xl border border-border/80 bg-card p-8 text-center shadow-xl">
                <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-card-2 text-muted">
                  <UserX className="size-7" />
                </div>
                <h2 className="mt-4 font-display text-lg font-bold">User Not Found</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                  No AnimeStream profile matches <span className="font-semibold text-foreground">@{partnerHandle}</span>.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/messages')}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-xl border border-border bg-card-2 px-4 py-2 text-xs font-semibold text-foreground transition hover:border-accent hover:text-accent active:scale-95"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Back to Inbox</span>
                </button>
              </div>
            </div>
          ) : !activePartner ? (
            <div className="relative z-10 m-auto w-full max-w-md p-6">
              <div className="rounded-3xl border border-border/80 bg-card p-8 text-center shadow-xl sm:p-10">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
                  <MessageSquare className="size-7" />
                </div>
                <h2 className="mt-5 font-display text-xl font-bold tracking-tight">Your Direct Messages</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted sm:text-sm">
                  Select a conversation from your inbox, search by <span className="font-medium text-foreground">@handle</span>, or connect with readers and viewers in Community.
                </p>
                <div className="mt-6 flex justify-center">
                  <Link
                    to="/community"
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-lg shadow-accent/20 transition hover:brightness-110 active:scale-95"
                  >
                    <Users className="size-4" />
                    Browse Community
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Partner Chat Header */}
              <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-3 py-2.5 sm:px-6 sm:py-3">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => navigate('/messages')}
                    aria-label="Back to conversations"
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/80 bg-card-2/80 text-foreground transition hover:border-accent hover:text-accent active:scale-90 md:hidden"
                  >
                    <ArrowLeft className="size-4" />
                  </button>

                  <Link
                    to={`/u/${activePartner.username}`}
                    title={`View @${activePartner.username}'s profile`}
                    className="group flex min-w-0 items-center gap-3 transition hover:opacity-90"
                  >
                    <Avatar
                      size={40}
                      name={activePartner.displayName}
                      src={activePartner.avatarUrl}
                      frame={activePartner.frame}
                      animateFrame
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StyledDisplayName
                          as="h2"
                          name={activePartner.displayName}
                          styleSpec={activePartner.nameStyle}
                          userId={activePartner.id}
                          className="truncate font-display text-sm font-bold text-foreground transition-colors group-hover:text-accent sm:text-base"
                        />
                        <span className="hidden truncate text-xs font-medium text-muted sm:inline">
                          @{activePartner.username}
                        </span>
                      </div>
                      <p className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="size-1.5 rounded-full bg-emerald-400" />
                        <span className="truncate sm:hidden">@{activePartner.username}</span>
                        <span className="hidden sm:inline">Direct message</span>
                      </p>
                    </div>
                  </Link>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    to={`/u/${activePartner.username}`}
                    className="hidden items-center gap-1.5 rounded-xl border border-border/80 bg-card-2/80 px-3 py-2 text-xs font-semibold text-muted transition hover:border-foreground/30 hover:text-foreground sm:inline-flex"
                  >
                    <span>Profile</span>
                    <ExternalLink className="size-3.5" />
                  </Link>

                  <button
                    type="button"
                    onClick={startPartnerCall}
                    title={`Voice call @${activePartner.username}`}
                    aria-label="Voice call"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-card-2/80 px-3 text-xs font-semibold text-foreground transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent active:scale-95"
                  >
                    <Phone className="size-3.5" />
                    <span className="hidden sm:inline">Call</span>
                  </button>
                </div>
              </header>

              {/* Messages Stream */}
              <div
                ref={messagesContainerRef}
                className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6"
              >
                {loadingMessages ? (
                  <div className="my-auto flex items-center justify-center gap-2 p-8 text-xs text-muted">
                    <Loader2 className="size-4 animate-spin text-accent" />
                    <span>Loading messages…</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="m-auto w-full max-w-md py-6">
                    <div className="rounded-3xl border border-border/80 bg-card p-6 text-center shadow-xl sm:p-8">
                      <Avatar
                        size={68}
                        name={activePartner.displayName}
                        src={activePartner.avatarUrl}
                        frame={activePartner.frame}
                        animateFrame
                        className="mx-auto"
                      />
                      <p className="mt-4 inline-flex items-center gap-1.5 eyebrow text-accent">
                        <Sparkles className="size-3" /> New Conversation
                      </p>
                      <StyledDisplayName
                        as="h3"
                        name={activePartner.displayName}
                        styleSpec={activePartner.nameStyle}
                        userId={activePartner.id}
                        className="mt-1 font-display text-lg font-bold tracking-tight text-foreground"
                      />
                      <p className="text-xs font-medium text-muted">@{activePartner.username}</p>
                      {activePartner.bio ? (
                        <p className="mx-auto mt-3 max-w-xs line-clamp-2 text-xs leading-relaxed text-muted">
                          {activePartner.bio}
                        </p>
                      ) : (
                        <p className="mx-auto mt-3 max-w-xs text-xs leading-relaxed text-muted">
                          Say hello, trade anime or manhwa recommendations, or jump into a call.
                        </p>
                      )}

                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {ICEBREAKERS.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => void sendText(prompt)}
                            className="rounded-xl border border-border/80 bg-card-2/80 px-3 py-1.5 text-xs font-medium text-foreground/90 transition hover:border-accent/60 hover:bg-accent/10 hover:text-accent active:scale-95"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (() => {
                  let lastCallIndex = -1
                  for (let i = messages.length - 1; i >= 0; i--) {
                    if (parseCallMessage(messages[i].content).isCall) {
                      lastCallIndex = i
                      break
                    }
                  }
                  return (
                    <div className="mx-auto flex w-full max-w-3xl flex-col">
                      {messages.map((m, idx) => {
                        const isMe = m.sender_id === user.id
                        const isTemp = m.id.startsWith('temp-')
                        const prev = messages[idx - 1]
                        const cm = parseCallMessage(m.content)
                        if (
                          cm.isCall &&
                          cm.status === 'started' &&
                          messages.slice(idx + 1).some((n) => {
                            const nextCm = parseCallMessage(n.content)
                            return nextCm.isCall && nextCm.status !== 'started'
                          })
                        ) {
                          return null
                        }
                        const showDay =
                          !prev ||
                          new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
                        const sameSenderAsPrev =
                          !showDay &&
                          prev &&
                          prev.sender_id === m.sender_id &&
                          !parseCallMessage(prev.content).isCall

                        return (
                          <div
                            key={keyOf.current.get(m.id) ?? m.id}
                            className={cn(sameSenderAsPrev ? 'mt-1' : 'mt-3.5 first:mt-0')}
                          >
                            {showDay && (
                              <div className="my-4 flex items-center gap-3">
                                <span className="h-px flex-1 bg-border/60" />
                                <span className="rounded-full border border-border/70 bg-card/80 px-3 py-0.5 text-[11px] font-medium text-muted">
                                  {dateDividerLabel(m.created_at)}
                                </span>
                                <span className="h-px flex-1 bg-border/60" />
                              </div>
                            )}

                            {(() => {
                              const callData = parseCallMessage(m.content)
                              if (callData.isCall) {
                                const isStarted = callData.status === 'started'
                                const isEnded = callData.status === 'ended'
                                const isDeclined = callData.status === 'declined'
                                const isMissed = callData.status === 'missed'

                                const isPartnerCall = Boolean(
                                  activeCall &&
                                    activeCall.status !== 'ended' &&
                                    activePartner &&
                                    activeCall.partner.id === activePartner.id,
                                )

                                const isThisMessageTheActiveCall = Boolean(
                                  isPartnerCall &&
                                    idx === lastCallIndex &&
                                    Date.now() - new Date(m.created_at).getTime() < 12 * 3600_000,
                                )

                                let cardTitle = 'Audio Call'
                                let cardSubtitle = `${timeLabel(m.created_at)}`
                                let isPositive = false

                                if (isEnded) {
                                  isPositive = true
                                  cardTitle = 'Audio Call'
                                  cardSubtitle =
                                    callData.duration && callData.duration > 0
                                      ? `Ended · ${formatCallDuration(callData.duration)}`
                                      : `Ended · ${timeLabel(m.created_at)}`
                                } else if (isDeclined) {
                                  isPositive = false
                                  cardTitle = isMe ? 'Call Declined' : 'Declined Audio Call'
                                  cardSubtitle = `Declined · ${timeLabel(m.created_at)}`
                                } else if (isMissed) {
                                  isPositive = false
                                  cardTitle = isMe ? 'Unanswered Call' : 'Missed Audio Call'
                                  cardSubtitle = `No answer · ${timeLabel(m.created_at)}`
                                } else if (isStarted) {
                                  if (isThisMessageTheActiveCall && activeCall) {
                                    isPositive = true
                                    cardTitle = isMe ? 'Outgoing Audio Call' : 'Incoming Audio Call'
                                    if (activeCall.status === 'calling') {
                                      cardSubtitle = 'Ringing…'
                                    } else if (activeCall.status === 'connecting') {
                                      cardSubtitle = 'Connecting…'
                                    } else if (activeCall.status === 'hold') {
                                      cardSubtitle = `On hold · ${formatCallTimer(liveCallSeconds)}`
                                    } else {
                                      cardSubtitle = `In progress · ${formatCallTimer(liveCallSeconds)}`
                                    }
                                  } else {
                                    isPositive = false
                                    cardTitle = isMe ? 'Unanswered Call' : 'Missed Audio Call'
                                    cardSubtitle = `No answer · ${timeLabel(m.created_at)}`
                                  }
                                }

                                return (
                                  <div className="my-2 flex w-full justify-center">
                                    <div
                                      className={cn(
                                        'inline-flex items-center gap-2.5 rounded-2xl border px-4 py-2 text-xs font-medium shadow-sm transition',
                                        isThisMessageTheActiveCall
                                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                          : 'border-border/80 bg-card/85 text-foreground/90',
                                      )}
                                    >
                                      {isThisMessageTheActiveCall ? (
                                        <span className="relative flex size-2 shrink-0">
                                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                                        </span>
                                      ) : isPositive ? (
                                        <PhoneCall className="size-3.5 shrink-0 text-accent" />
                                      ) : (
                                        <PhoneOff className="size-3.5 shrink-0 text-muted" />
                                      )}

                                      <span className="font-semibold">{cardTitle}</span>
                                      <span className="text-muted">·</span>
                                      <span className="text-[11px] text-muted">{cardSubtitle}</span>

                                      {isThisMessageTheActiveCall ? (
                                        <button
                                          type="button"
                                          onClick={() => navigate('/call')}
                                          className="ml-1 inline-flex items-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95"
                                        >
                                          <span>Open call</span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={startPartnerCall}
                                          className="ml-1 text-[11px] font-bold text-accent underline-offset-2 transition hover:underline"
                                        >
                                          Call back
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              }

                              return (
                                <motion.div
                                  initial={
                                    seen.current.has(m.id) || keyOf.current.has(m.id)
                                      ? false
                                      : { opacity: 0, y: 12, scale: 0.95 }
                                  }
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                                  style={{ transformOrigin: isMe ? 'bottom right' : 'bottom left' }}
                                  className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}
                                >
                                  <div
                                    className={cn(
                                      'relative max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm sm:max-w-[68%] sm:text-sm',
                                      isMe
                                        ? 'rounded-br-md bg-accent text-accent-fg shadow-accent/15'
                                        : 'rounded-bl-md border border-border/80 bg-card text-foreground',
                                    )}
                                  >
                                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                    <div
                                      className={cn(
                                        'mt-1 flex items-center justify-end gap-1 text-[10px]',
                                        isMe ? 'text-accent-fg/75' : 'text-muted',
                                      )}
                                    >
                                      <span>{timeLabel(m.created_at)}</span>
                                      {isMe &&
                                        (isTemp ? (
                                          <Loader2 className="size-2.5 animate-spin" />
                                        ) : m.read ? (
                                          <CheckCheck className="size-3 text-emerald-300" />
                                        ) : (
                                          <Check className="size-3" />
                                        ))}
                                    </div>
                                  </div>
                                </motion.div>
                              )
                            })()}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>

              {/* Floating Composer Dock */}
              <div
                className="relative z-10 shrink-0 border-t border-border/60 bg-card px-3 py-2.5 sm:px-6 sm:py-3.5"
                style={{ paddingBottom: 'max(0.7rem, env(safe-area-inset-bottom))' }}
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSend()
                  }}
                  className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border/80 bg-card-2/90 p-1.5 shadow-lg shadow-black/15 transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
                >
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message @${activePartner.username}…`}
                    className="max-h-28 flex-1 resize-none bg-transparent px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted sm:text-sm"
                  />

                  <span className="hidden self-center pr-1 text-[10px] font-medium text-muted/70 md:inline">
                    Enter to send
                  </span>

                  <motion.button
                    type="submit"
                    disabled={!text.trim() || sending}
                    aria-label="Send message"
                    whileTap={{ scale: 0.9 }}
                    animate={{ scale: text.trim() ? 1 : 0.94, opacity: text.trim() ? 1 : 0.45 }}
                    className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg shadow-md shadow-accent/20 disabled:pointer-events-none"
                  >
                    <motion.span
                      key={sendTick}
                      initial={sendTick ? { x: -5, y: 5, opacity: 0 } : false}
                      animate={{ x: 0, y: 0, opacity: 1 }}
                      className="grid place-items-center"
                    >
                      <Send className="size-4" />
                    </motion.span>
                  </motion.button>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  )
}
