import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, Send } from 'lucide-react';
import { communityApi } from '../lib/endpoints';
import { getSocket } from '../lib/socket';
import { Button, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../store/auth';
import type { Message } from '../lib/types';

export default function GroupChat() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [roomJoined, setRoomJoined] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const groups = useQuery({ queryKey: ['groups'], queryFn: communityApi.groups });
  const group = groups.data?.find((g) => g.id === id);

  const history = useQuery({ queryKey: ['messages', id], queryFn: () => communityApi.messages(id), enabled: !!id });

  useEffect(() => {
    if (history.data) {
      setMessages(history.data.messages);
      setChatOpen(history.data.chatOpen);
    }
  }, [history.data]);

  useEffect(() => {
    if (!id) return;
    const socket = getSocket();
    let active = true;
    const joinRoom = () => {
      setRoomJoined(false);
      socket.emit('group:join', id, (joined: boolean) => {
        if (active) setRoomJoined(joined);
      });
    };
    const onConnect = () => joinRoom();
    const onDisconnect = () => setRoomJoined(false);
    const onMessage = (m: Message) => {
      if (m.groupId === id) setMessages((prev) => [...prev, m]);
    };
    const onTyping = (p: { typing: boolean }) => setTyping(p.typing);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('group:message', onMessage);
    socket.on('typing', onTyping);
    if (socket.connected) joinRoom();
    return () => {
      active = false;
      socket.emit('group:leave', id);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('group:message', onMessage);
      socket.off('typing', onTyping);
    };
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function send() {
    if (!text.trim() || !roomJoined || sending) return;
    const socket = getSocket();
    const body = text.trim();
    setSending(true);
    let acknowledged = false;
    const timeout = window.setTimeout(() => {
      if (!acknowledged) {
        setSending(false);
        toast('The chat connection timed out. Please try again.', 'error');
      }
    }, 5000);
    socket.emit('group:message', { groupId: id, body }, (sent: boolean) => {
      acknowledged = true;
      window.clearTimeout(timeout);
      setSending(false);
      if (!sent) {
        toast('Your message was not sent. Check your room access or try again.', 'error');
        return;
      }
      setText((current) => (current === body ? '' : current));
      qc.invalidateQueries({ queryKey: ['posts'] });
    });
  }

  return (
    <div className="chat-viewport flex flex-col">
      <header className="flex items-center gap-3 border-b border-cream-200 bg-white px-4 py-3 md:px-8">
        <Link to="/community" className="rounded-lg p-1 text-ink-muted transition-colors hover:bg-cream-100 hover:text-ink">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold tracking-tight">{group?.name ?? 'Group Chat'}</p>
          <p className="truncate text-xs text-ink-muted">
            {typing ? 'Someone is typing…' : group?.description ?? 'Community chat'}
          </p>
        </div>
        {group?.accessTier && group.accessTier !== 'FREE' && (
          <span className="rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold tracking-wide text-gold-100">
            {group.accessTier === 'VIP_DERIV' ? 'DERIV VIP' : group.accessTier === 'VIP_WELTRADE' ? 'WELTRADE VIP' : 'PAID'}
          </span>
        )}
        {!chatOpen && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-danger">CHAT CLOSED</span>}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-8">
        {history.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6 text-gold-400" />
          </div>
        ) : history.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-muted">
            <Lock className="h-6 w-6" />
            <p className="text-sm">Unable to load this room. Check your access or try again.</p>
            <Button size="sm" variant="outline" onClick={() => history.refetch()}>Try again</Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">No messages yet. Start the conversation.</p>
        ) : (
          messages.map((m) => {
            const mine = m.user.id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] break-words rounded-2xl border px-3.5 py-2.5 text-sm sm:max-w-[78%] ${mine ? 'border-gold-700 bg-gold-700 text-white' : 'border-cream-200 bg-white text-ink shadow-card'}`}>
                  {!mine && <p className="mb-0.5 text-[11px] font-semibold text-gold-800">{m.user.name}</p>}
                  <p className="whitespace-pre-line">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${mine ? 'text-white/80' : 'text-ink-faint'}`}>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!chatOpen && user?.role !== 'ADMIN' ? (
        <div className="border-t border-cream-200 bg-red-50 px-4 py-3 text-center text-xs font-semibold text-danger md:px-8">
          An administrator has closed the chat in this room. You can still read messages.
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-cream-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(23,25,29,0.04)] md:px-8">
          <input
            className="input py-2.5"
            placeholder={!roomJoined ? 'Connecting to room…' : chatOpen ? 'Type a message…' : 'Chat closed (admin can still post)'}
            aria-label="Chat message"
            maxLength={2000}
            value={text}
            disabled={!roomJoined || sending}
            onChange={(e) => {
              setText(e.target.value);
              getSocket().emit('typing', { groupId: id, typing: e.target.value.length > 0 });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button onClick={send} disabled={!text.trim() || !roomJoined || sending} loading={sending} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
