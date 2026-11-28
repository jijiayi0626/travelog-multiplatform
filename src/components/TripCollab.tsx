import { useCallback, useEffect, useState } from 'react'
import {
  ChatCircleDots,
  CheckCircle,
  PaperPlaneTilt,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react'
import type { Comment, Poll, Profile } from '../lib/types'
import {
  closePoll,
  deleteComment,
  getProfile,
  listComments,
  listPolls,
  saveComment,
  savePoll,
  votePoll,
} from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { isSignedIn, getCloudConfig } from '../lib/cloud'
import { runSync } from '../lib/sync-engine'
import { useRefresh, useI18n, useToast } from '../lib/app-context'
import { relativeTime, uid } from '../lib/utils'
import { cn } from '../lib/cn'
import { Avatar, ConfirmDialog, EmptyState, Sheet } from './ui'

interface CollabData {
  comments: Comment[]
  polls: Poll[]
  profile: Profile
}

const EMPTY_DATA: CollabData = {
  comments: [],
  polls: [],
  profile: { id: 'local-user', nickname: '', avatar: '', createdAt: 0 },
}

const MAX_COMMENT = 500
const MAX_OPTIONS = 6
const GUEST_ID_KEY = 'travelog.viewerId'

/** 协作身份：登录后使用账号 userId，游客使用本机固定 id，保证不同设备投票互不覆盖 */
function viewerId(): string {
  const accountId = getCloudConfig().userId
  if (accountId) return accountId
  try {
    const stored = localStorage.getItem(GUEST_ID_KEY)
    if (stored) return stored
    const next = `guest-${uid().slice(0, 12)}`
    localStorage.setItem(GUEST_ID_KEY, next)
    return next
  } catch {
    return `guest-${uid().slice(0, 12)}`
  }
}

export function TripCollab({ tripId }: { tripId: string }) {
  const { tr } = useI18n()
  const toast = useToast()
  const { bump } = useRefresh()
  const [signedIn] = useState(isSignedIn)
  const [meId] = useState(viewerId)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Comment | null>(null)
  const [pollOpen, setPollOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [optionTexts, setOptionTexts] = useState<string[]>(['', ''])

  const loader = useCallback(async (): Promise<CollabData> => {
    const [comments, polls, profile] = await Promise.all([
      listComments(tripId),
      listPolls(tripId),
      getProfile(),
    ])
    return { comments, polls, profile }
  }, [tripId])

  const { data } = useLoader(loader, EMPTY_DATA, tripId)
  const { comments, polls, profile } = data

  // 进入协作页先拉一次，把旅伴刚发的评论 / 投票带下来
  useEffect(() => {
    if (!isSignedIn()) return
    void runSync({ pullOnly: true }).catch(() => undefined)
  }, [])

  // 同步完成后刷新列表
  useEffect(() => {
    const onDone = () => bump()
    window.addEventListener('travelog:sync-done', onDone)
    return () => window.removeEventListener('travelog:sync-done', onDone)
  }, [bump])

  // 停留在协作页时，页面可见就每 20 秒拉一次增量
  useEffect(() => {
    if (!isSignedIn()) return
    let busy = false
    const timer = window.setInterval(() => {
      if (busy || document.visibilityState !== 'visible' || !navigator.onLine) return
      busy = true
      void runSync({ pullOnly: true })
        .catch(() => undefined)
        .finally(() => {
          busy = false
        })
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [])

  const submitComment = async () => {
    const text = draft.trim()
    if (!text) {
      toast(tr('写点什么再发送'))
      return
    }
    setSending(true)
    try {
      await saveComment({
        id: '',
        tripId,
        userId: meId,
        name: profile.nickname || tr('我'),
        text: text.slice(0, MAX_COMMENT),
        createdAt: 0,
        updatedAt: 0,
        syncState: 0,
      })
      setDraft('')
      bump()
    } finally {
      setSending(false)
    }
  }

  const castVote = async (poll: Poll, optionId: string) => {
    if (poll.closed) return
    await votePoll(poll.id, optionId, meId)
    bump()
  }

  const endPoll = async (poll: Poll) => {
    await closePoll(poll.id)
    bump()
    toast(tr('投票已结束'))
  }

  const resetPollForm = () => {
    setQuestion('')
    setOptionTexts(['', ''])
  }

  const createPoll = async () => {
    const title = question.trim()
    const texts = optionTexts.map((item) => item.trim()).filter(Boolean)
    if (!title) {
      toast(tr('先写下投票问题'))
      return
    }
    if (texts.length < 2) {
      toast(tr('至少需要两个选项'))
      return
    }
    await savePoll({
      id: '',
      tripId,
      question: title,
      options: texts.map((text) => ({ id: uid(), text, votes: [] })),
      createdBy: meId,
      closed: false,
      createdAt: 0,
      updatedAt: 0,
      syncState: 0,
    })
    setPollOpen(false)
    resetPollForm()
    bump()
    toast(tr('投票已发起'))
  }

  return (
    <div className="space-y-5">
      {!signedIn ? (
        <p className="rounded-xl border border-line bg-paper-2 px-3 py-2 text-note leading-4 text-ink-3">
          {tr('登录后可同步给旅伴')}
        </p>
      ) : null}

      <section className="card p-4">
        <h2 className="flex items-center gap-1.5 text-note font-semibold tracking-tight text-ink">
          <ChatCircleDots size={16} />
          {tr('旅伴评论')}
        </h2>

        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (sending) return
            void submitComment()
          }}
        >
          <textarea
            className="input-area min-h-[76px]"
            rows={3}
            maxLength={MAX_COMMENT}
            placeholder={tr('说点什么，比如集合时间、想去的店…')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-caption tabular-nums text-ink-3">
              {draft.length}/{MAX_COMMENT}
            </span>
            <button type="submit" className="btn-primary h-9 px-3.5 text-note" disabled={sending}>
              <PaperPlaneTilt size={14} weight="fill" />
              {tr('发送')}
            </button>
          </div>
        </form>

        <div className="mt-4 space-y-3">
          {comments.length === 0 ? (
            <EmptyState
              icon={<ChatCircleDots size={20} />}
              title={tr('还没有人留言')}
              hint={tr('把集合时间、想吃的店写在第一条评论里。')}
            />
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="flex gap-2.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <Avatar name={comment.name || tr('旅伴')} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-note font-medium text-ink">{comment.name}</span>
                    <span className="shrink-0 text-caption text-ink-3">{relativeTime(comment.createdAt)}</span>
                    {comment.userId === meId ? (
                      <button
                        type="button"
                        aria-label={tr('删除评论')}
                        onClick={() => setPendingDelete(comment)}
                        className="press ml-auto shrink-0 rounded-full p-1 text-ink-3 hover:text-danger"
                      >
                        <Trash size={13} />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-body-sm leading-5 text-ink-2">
                    {comment.text}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-note font-semibold tracking-tight text-ink">
            <ChatCircleDots size={16} />
            {tr('旅伴投票')}
          </h2>
          <button
            type="button"
            onClick={() => setPollOpen(true)}
            className="press inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-caption text-ink-2 hover:text-ink"
          >
            <Plus size={12} weight="bold" />
            {tr('发起投票')}
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {polls.length === 0 ? (
            <EmptyState
              icon={<ChatCircleDots size={20} />}
              title={tr('还没有投票')}
              hint={tr('拿不定主意时，发个投票让旅伴一起选。')}
            />
          ) : (
            polls.map((poll) => {
              const total = poll.options.reduce((sum, option) => sum + option.votes.length, 0)
              const myOptionId = poll.options.find((option) => option.votes.includes(meId))?.id
              const mine = poll.createdBy === meId
              return (
                <div key={poll.id} className="rounded-2xl border border-line bg-surface p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-body font-medium leading-5 text-ink">{poll.question}</p>
                    {poll.closed ? (
                      <span className="shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3">
                        {tr('已结束')}
                      </span>
                    ) : mine ? (
                      <button
                        type="button"
                        onClick={() => void endPoll(poll)}
                        className="press shrink-0 rounded-full border border-line px-2 py-0.5 text-caption text-ink-2 hover:text-ink"
                      >
                        {tr('结束投票')}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-caption text-ink-3">{tr('共 {n} 票', { n: total })}</p>

                  <div className="mt-2.5 space-y-1.5">
                    {poll.options.map((option) => {
                      const count = option.votes.length
                      const percent = total > 0 ? Math.round((count / total) * 100) : 0
                      const isMine = option.id === myOptionId
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={poll.closed}
                          onClick={() => void castVote(poll, option.id)}
                          className={cn(
                            'relative block w-full overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors',
                            isMine ? 'border-accent bg-accent-soft/60' : 'border-line bg-paper-2',
                            poll.closed ? 'cursor-default opacity-90' : 'press hover:border-accent/50',
                          )}
                        >
                          <span
                            className="pointer-events-none absolute inset-y-0 left-0 bg-accent/10"
                            style={{ width: `${percent}%` }}
                            aria-hidden="true"
                          />
                          <span className="relative flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'flex min-w-0 items-center gap-1.5 text-body-sm',
                                isMine ? 'font-medium text-accent' : 'text-ink-2',
                              )}
                            >
                              <span className="truncate">{option.text}</span>
                              {isMine ? <CheckCircle size={14} weight="fill" /> : null}
                            </span>
                            <span className="shrink-0 text-caption tabular-nums text-ink-3">
                              {percent}% · {count}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <Sheet
        open={pollOpen}
        title={tr('发起投票')}
        onClose={() => {
          setPollOpen(false)
          resetPollForm()
        }}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => {
                setPollOpen(false)
                resetPollForm()
              }}
            >
              {tr('取消')}
            </button>
            <button type="button" className="btn-primary flex-1" onClick={() => void createPoll()}>
              {tr('发起')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-2">
            <span className="field-label">{tr('问题')}</span>
            <input
              type="text"
              className="input"
              autoComplete="off"
              placeholder={tr('例如「晚饭吃什么」')}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>

          <div className="space-y-2">
            <span className="field-label">{tr('选项（2–6 个）')}</span>
            {optionTexts.map((text, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  className="input"
                  autoComplete="off"
                  placeholder={tr('选项 {n}', { n: index + 1 })}
                  value={text}
                  onChange={(event) =>
                    setOptionTexts((current) =>
                      current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                    )
                  }
                />
                {optionTexts.length > 2 ? (
                  <button
                    type="button"
                    aria-label={tr('删除选项')}
                    onClick={() => setOptionTexts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="press flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-line text-ink-3 hover:text-danger"
                  >
                    <X size={15} />
                  </button>
                ) : null}
              </div>
            ))}
            {optionTexts.length < MAX_OPTIONS ? (
              <button
                type="button"
                onClick={() => setOptionTexts((current) => [...current, ''])}
                className="press inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-caption text-ink-2 hover:text-ink"
              >
                <Plus size={12} weight="bold" />
                {tr('添加选项')}
              </button>
            ) : null}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={tr('删除这条评论？')}
        message={tr('删除后旅伴也将看不到这条评论。')}
        onConfirm={() => {
          if (pendingDelete) void deleteComment(pendingDelete.id).then(() => bump())
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
