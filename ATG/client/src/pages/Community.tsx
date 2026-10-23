import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Heart, Lock, MessageCircle, MessagesSquare, Plus, Search, Trash2 } from 'lucide-react';
import { communityApi } from '../lib/endpoints';
import { Button, Chip, Modal, SkeletonRow, Textarea } from '../components/ui';
import { useToast } from '../components/Toast';
import { apiError } from '../lib/api';
import type { Group, Post } from '../lib/types';
import { useAuth } from '../store/auth';
import type { UseQueryResult } from '@tanstack/react-query';

const tabs = ['All', 'Analysis', 'Wins', 'Questions'];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function Avatar({ post }: { post: Post }) {
  const initials = post.author.name.slice(0, 2).toUpperCase();
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-bold text-gold-200">
      {post.author.avatarUrl ? <img src={post.author.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : initials}
    </div>
  );
}

export default function Community() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ body: '', kind: 'POST', groupId: '' });
  const [expanded, setExpanded] = useState<string | null>(null);

  const rooms = useQuery({ queryKey: ['groups'], queryFn: communityApi.groups });
  const writableRooms = (rooms.data ?? []).filter((room) => room.canAccess);
  const defaultRoomId = writableRooms.find((room) => room.accessTier === 'FREE')?.id ?? writableRooms[0]?.id ?? '';
  const selectedRoomId = draft.groupId || defaultRoomId;
  const posts = useQuery({ queryKey: ['posts', tab, q], queryFn: () => communityApi.posts({ category: tab, q }) });
  const comments = useQuery({
    queryKey: ['comments', expanded],
    queryFn: () => communityApi.comments(expanded!),
    enabled: !!expanded,
  });

  const like = useMutation({
    mutationFn: (id: string) => communityApi.like(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
    onError: (e) => toast(apiError(e), 'error'),
  });

  const create = useMutation({
    mutationFn: () => communityApi.createPost({ body: draft.body.trim(), kind: draft.kind, groupId: selectedRoomId || undefined }),
    onSuccess: () => {
      toast('Posted to the community 🎉', 'success');
      setDraft({ body: '', kind: 'POST', groupId: '' });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['posts'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => communityApi.removePost(id),
    onSuccess: () => {
      toast('Post removed', 'success');
      if (expanded) setExpanded(null);
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
    onError: (e) => toast(apiError(e), 'error'),
  });

  function confirmRemove(post: Post) {
    const ownPost = post.author.id === user?.id;
    const message = ownPost ? 'Delete your post and its replies?' : 'Remove this community post and its replies?';
    if (window.confirm(message)) remove.mutate(post.id);
  }

  return (
    <div className="animate-rise px-4 pt-4 md:px-8 md:pt-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Community</h1>
          <p className="muted">Connect. Learn. Share.</p>
        </div>
        <div className="flex min-w-0 flex-1 items-center rounded-xl border border-cream-300 bg-white px-3 py-2.5 sm:max-w-56">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            aria-label="Search community posts"
            className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-ink-faint"
          />
        </div>
      </header>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {tabs.map((t) => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>
            {t}
          </Chip>
        ))}
      </div>

      <Rooms rooms={rooms} />

      <div className="space-y-3">
        {posts.isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : posts.isError ? (
          <div className="card flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="text-sm font-semibold">Community posts couldn&apos;t be loaded.</p>
            <p className="text-xs text-ink-muted">Check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={() => posts.refetch()}>Try again</Button>
          </div>
        ) : (posts.data ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">No posts yet. Be the first to share!</p>
        ) : (
          posts.data!.map((p) => (
            <article key={p.id} className="card p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <Avatar post={p} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {p.author.name}
                    {p.author.role === 'ADMIN' && <span className="ml-1 rounded-full border border-gold-100 bg-gold-50 px-2 py-0.5 text-[10px] font-bold text-gold-800">ATG ADMIN</span>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {p.group?.name ? `${p.group.name} · ` : ''}{postKindLabel(p.kind)} · {timeAgo(p.createdAt)}
                  </p>
                </div>
                {(user?.role === 'ADMIN' || p.author.id === user?.id) && (
                  <button
                    type="button"
                    onClick={() => confirmRemove(p)}
                    disabled={remove.isPending}
                    className="rounded-lg p-2 text-ink-faint hover:bg-red-50 hover:text-danger disabled:opacity-50"
                    aria-label={user?.role === 'ADMIN' && p.author.id !== user.id ? 'Remove community post' : 'Delete your post'}
                    title={user?.role === 'ADMIN' && p.author.id !== user.id ? 'Remove post' : 'Delete your post'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <p className="mt-3 whitespace-pre-line text-sm text-ink-soft">{p.body}</p>
              {p.imageUrl && (
                <div className="mt-3 overflow-hidden rounded-xl">
                  <img src={p.imageUrl} alt="" className="h-40 w-full object-cover" loading="lazy" />
                </div>
              )}

              <div className="mt-3 flex items-center gap-4 text-xs">
                <button
                  onClick={() => like.mutate(p.id)}
                  disabled={like.isPending}
                  className={`flex items-center gap-1.5 font-medium ${p.likedByMe ? 'text-danger' : 'text-ink-muted'}`}
                >
                  <Heart className={p.likedByMe ? 'h-4 w-4 fill-danger' : 'h-4 w-4'} /> {p.likeCount}
                </button>
                <button
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  className="flex items-center gap-1.5 font-medium text-ink-muted"
                >
                  <MessageCircle className="h-4 w-4" /> {p.commentCount}
                </button>
              </div>

              {expanded === p.id && (
                <div className="mt-3 space-y-2 border-t border-cream-200 pt-3">
                  {comments.isLoading ? (
                    <p className="text-xs text-ink-muted">Loading comments…</p>
                  ) : comments.isError ? (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-danger">Replies couldn&apos;t be loaded.</p>
                      <Button size="sm" variant="outline" onClick={() => comments.refetch()}>Retry</Button>
                    </div>
                  ) : (comments.data ?? []).length === 0 ? (
                    <p className="text-xs text-ink-muted">No comments yet.</p>
                  ) : (
                    comments.data!.map((c: { id: string; body: string; user: { name: string; role?: string } }) => (
                      <div key={c.id} className="rounded-lg bg-cream-100 px-3 py-2">
                        <p className="text-xs font-semibold">
                          {c.user.name}
                          {c.user.role === 'ADMIN' && <span className="ml-1 rounded-full bg-gold-soft px-1.5 py-0.5 text-[9px] font-bold text-gold-700">ATG ADMIN</span>}
                        </p>
                        <p className="text-xs text-ink-soft">{c.body}</p>
                      </div>
                    ))
                  )}
                  <CommentBox postId={p.id} onDone={() => {
                    qc.invalidateQueries({ queryKey: ['comments', p.id] });
                    qc.invalidateQueries({ queryKey: ['posts'] });
                  }} />
                </div>
              )}
            </article>
          ))
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-gold-gradient text-white shadow-gold md:bottom-8 md:right-8"
        aria-label="New post"
      >
        <Plus className="h-6 w-6" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Create a post">
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">
            {user?.role === 'ADMIN'
              ? 'Share an update with members. They will be notified and can reply here.'
              : 'Your post will be shared with the community. ATG Admin can reply here, and you will be notified.'}
          </p>
          <div className="flex gap-2">
            {['POST', 'ANALYSIS', 'WIN', 'QUESTION'].map((k) => (
              <Chip key={k} active={draft.kind === k} onClick={() => setDraft((d) => ({ ...d, kind: k }))}>
                {k[0] + k.slice(1).toLowerCase()}
              </Chip>
            ))}
          </div>
          <label className="block">
            <span className="label">Share in room</span>
            <select
              className="input"
              value={selectedRoomId}
              onChange={(event) => setDraft((current) => ({ ...current, groupId: event.target.value }))}
              disabled={rooms.isLoading || writableRooms.length === 0}
            >
              {writableRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}{room.accessTier !== 'FREE' ? ` · ${room.accessTier.replace(/_/g, ' ')}` : ''}
                </option>
              ))}
            </select>
          </label>
          {user?.role === 'ADMIN' && (
            <p className="text-xs text-ink-muted">
              Members with access to the selected room will receive a notification.
            </p>
          )}
          {rooms.isError && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-red-50 p-3">
              <p className="text-xs text-danger">Community rooms couldn&apos;t be loaded.</p>
              <Button size="sm" variant="outline" onClick={() => rooms.refetch()}>Retry</Button>
            </div>
          )}
          <Textarea
            maxLength={2000}
            placeholder="Share your analysis, a win, or ask a question…"
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
          />
          <p className="text-right text-[11px] text-ink-faint">{draft.body.length}/2000</p>
          <Button
            size="lg"
            loading={create.isPending}
            disabled={draft.body.trim().length === 0 || rooms.isLoading || writableRooms.length === 0}
            onClick={() => create.mutate()}
          >
            Post
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Rooms({ rooms }: { rooms: UseQueryResult<Group[], Error> }) {
  const list = rooms.data ?? [];
  if (rooms.isLoading || (rooms.isSuccess && list.length === 0)) return null;
  return (
    <div className="mb-4">
      <h2 className="section-title mb-2">Rooms</h2>
      {rooms.isError ? (
        <div className="card flex items-center justify-between gap-3 p-3">
          <p className="text-xs text-danger">Rooms couldn&apos;t be loaded.</p>
          <Button size="sm" variant="outline" onClick={() => rooms.refetch()}>Retry</Button>
        </div>
      ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {list.map((g) => (
          <div key={g.id} className="card flex items-center gap-3 p-3.5 transition-colors hover:border-cream-300">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-cream-200 bg-cream-100 text-gold-700">
              <MessagesSquare className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{g.name}</p>
              <p className="truncate text-xs text-ink-muted">
                {g.canAccess ? (g.chatOpen ? 'Chat open' : 'Chat closed') : 'Members only'}
                {typeof g._count?.messages === 'number' ? ` · ${g._count.messages} messages` : ''}
              </p>
            </div>
            {g.canAccess ? (
              <Link to={`/community/${g.id}`} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gold-800 transition-colors hover:bg-gold-50">
                Open
              </Link>
            ) : (
              <Link to="/profile/subscription" className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-gold-800 transition-colors hover:bg-gold-50">
                <Lock className="h-3 w-3" /> Unlock
              </Link>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

function postKindLabel(kind: Post['kind']) {
  return { POST: 'Post', ANALYSIS: 'Analysis', WIN: 'Win', QUESTION: 'Question' }[kind];
}

function CommentBox({ postId, onDone }: { postId: string; onDone: () => void }) {
  const { toast } = useToast();
  const [body, setBody] = useState('');
  const mutation = useMutation({
    mutationFn: () => communityApi.addComment(postId, body),
    onSuccess: () => {
      setBody('');
      onDone();
    },
    onError: (e) => toast(apiError(e), 'error'),
  });
  return (
    <div className="flex items-center gap-2">
      <input
        className="input py-2"
        placeholder="Add a comment…"
        aria-label="Add a comment"
        maxLength={1000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && body.trim() && !mutation.isPending) {
            e.preventDefault();
            mutation.mutate();
          }
        }}
      />
      <Button size="sm" loading={mutation.isPending} disabled={!body.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
        Send
      </Button>
    </div>
  );
}
