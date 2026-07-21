'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Users,
  Search,
  UserPlus,
  UserMinus,
  ShieldCheck,
  ShieldOff,
  LogOut,
  Camera,
  Loader2,
  AlertCircle,
  Crown,
} from 'lucide-react';

import { groupChatApi, type GroupChatMember } from '../../lib/api/group-chat';
import { usersApi, type UserSearchResult } from '../../lib/api/users';
import { ApiClientError } from '../../lib/api-client';
import { getCurrentUser } from '../../lib/auth';
import { getMediaKind, uploadFile } from '../../lib/upload';
import { cn } from '../../lib/utils';

interface GroupMembersPanelProps {
  locale: string;
  groupId: string;
  onClose: () => void;
}

const ROLE_LABEL: Record<GroupChatMember['role'], string> = {
  OWNER: "Egasi",
  ADMIN: 'Admin',
  MEMBER: "A'zo",
};

export function GroupMembersPanel({ locale, groupId, onClose }: GroupMembersPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = getCurrentUser();
  const myId = currentUser?.sub ?? null;
  const [addOpen, setAddOpen] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(rawQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [rawQuery]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groupQuery = useQuery({
    queryKey: ['group-chat', 'group', groupId],
    queryFn: () => groupChatApi.getGroup(groupId),
  });
  const membersQuery = useQuery({
    queryKey: ['group-chat', 'members', groupId],
    queryFn: () => groupChatApi.listMembers(groupId),
  });
  const avatarQuery = useQuery({
    queryKey: ['group-chat', 'avatar-url', groupId],
    queryFn: () => groupChatApi.getAvatarUrl(groupId),
    enabled: !!groupQuery.data?.hasAvatar,
  });

  const searchQuery = useQuery({
    queryKey: ['users', 'search', debounced],
    queryFn: () => usersApi.searchUsers(debounced),
    enabled: addOpen && debounced.length >= 2,
    staleTime: 60_000,
  });

  const myRole = groupQuery.data?.myRole;
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['group-chat', 'members', groupId] });
    queryClient.invalidateQueries({ queryKey: ['group-chat', 'group', groupId] });
    queryClient.invalidateQueries({ queryKey: ['group-chat', 'groups'] });
  }

  const addMember = useMutation({
    mutationFn: (userId: string) => groupChatApi.addMember(groupId, userId),
    onSuccess: () => {
      invalidateAll();
      setAddOpen(false);
      setRawQuery('');
      setDebounced('');
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => groupChatApi.removeMember(groupId, userId),
    onSuccess: invalidateAll,
  });

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'ADMIN' | 'MEMBER' }) =>
      groupChatApi.setRole(groupId, userId, role),
    onSuccess: invalidateAll,
  });

  const leaveGroup = useMutation({
    mutationFn: () => groupChatApi.leaveGroup(groupId),
    onSuccess: () => {
      invalidateAll();
      onClose();
      router.push(`/${locale}/messages`);
    },
  });

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    setAvatarUploading(true);
    try {
      const assetId = await uploadFile(file, getMediaKind(file));
      await groupChatApi.setAvatar(groupId, assetId);
      queryClient.invalidateQueries({ queryKey: ['group-chat', 'avatar-url', groupId] });
      invalidateAll();
    } catch (err) {
      setAvatarError(
        err instanceof ApiClientError ? err.message : "Rasmni yuklab bo'lmadi.",
      );
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const members = membersQuery.data ?? [];
  const users = searchQuery.data ?? [];
  const existingIds = new Set(members.map((m) => m.userId));
  const avatarUrl = avatarQuery.data?.url ?? null;

  return (
    <div
      role="dialog"
      aria-label="Guruh a'zolari"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-md animate-in fade-in duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-rim bg-white shadow-2xl animate-in slide-in-from-right duration-300">
        <header className="flex items-center justify-between gap-3 border-b border-rim bg-tint/30 px-6 py-6">
          <div>
            <h2 className="font-display text-lg font-extrabold tracking-tight text-ink-strong">
              Guruh a&apos;zolari
            </h2>
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
              {groupQuery.data?.name ?? ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-ink-faint transition-all hover:bg-white hover:text-ink-strong active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex items-center gap-4 border-b border-rim px-6 py-5">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-purple/10 bg-purple-tint text-purple shadow-sm">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Users className="h-7 w-7" />
            )}
            {avatarUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-strong">{groupQuery.data?.name}</p>
            <p className="text-xs font-medium text-ink-soft">{members.length} a&apos;zo</p>
            {canManage && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 flex items-center gap-1.5 text-xs font-bold text-blue hover:text-blue-600"
              >
                <Camera className="h-3.5 w-3.5" />
                Rasm o&apos;rnatish
              </button>
            )}
            {avatarError && <p className="mt-1 text-[10px] font-medium text-red">{avatarError}</p>}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
          </div>
        </div>

        {canManage && (
          <div className="px-6 py-4">
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue px-4 py-2.5 text-xs font-bold text-white shadow-blue-soft transition-all hover:bg-blue-600 active:scale-[0.98]"
            >
              <UserPlus className="h-4 w-4" />
              A&apos;zo qo&apos;shish
            </button>

            {addOpen && (
              <div className="mt-3 rounded-2xl border border-rim bg-tint/30 p-3">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    type="search"
                    autoFocus
                    value={rawQuery}
                    onChange={(e) => setRawQuery(e.target.value)}
                    placeholder="Username orqali qidirish..."
                    className="w-full rounded-xl border border-rim bg-white py-2.5 pl-10 pr-4 text-xs outline-none transition-all focus:border-blue/30 focus:ring-4 focus:ring-blue/5"
                  />
                </div>
                {addMember.isError && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-red-tint px-3 py-2 text-[10px] font-bold text-red">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {addMember.error instanceof ApiClientError
                      ? addMember.error.message
                      : "Qo'shib bo'lmadi."}
                  </div>
                )}
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {users
                    .filter((u: UserSearchResult) => !existingIds.has(u.id))
                    .map((u: UserSearchResult) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => addMember.mutate(u.id)}
                          disabled={addMember.isPending}
                          className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white disabled:opacity-60"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-rim bg-white">
                            {u.avatarUrl ? (
                              <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-xs font-bold text-blue">{u.fullName.charAt(0)}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold text-ink-strong">{u.fullName}</p>
                            <p className="truncate text-[10px] text-ink-faint">@{u.username}</p>
                          </div>
                          {addMember.isPending && addMember.variables === u.id && (
                            <Loader2 className="h-4 w-4 animate-spin text-blue" />
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {membersQuery.isLoading ? (
            <div className="space-y-2 px-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-tint" />
              ))}
            </div>
          ) : (
            <ul className="space-y-1">
              {members.map((m) => {
                const isSelf = m.userId === myId;
                return (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-tint/50"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-rim bg-tint">
                      {m.user.avatarUrl ? (
                        <img src={m.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-display text-sm font-bold text-blue">
                          {m.user.fullName.charAt(0)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-ink-strong">
                        {m.user.fullName} {isSelf && <span className="text-ink-faint">(siz)</span>}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {m.role === 'OWNER' && <Crown className="h-3 w-3 text-orange" />}
                        <span
                          className={cn(
                            'text-[9px] font-bold uppercase tracking-wider',
                            m.role === 'OWNER'
                              ? 'text-orange'
                              : m.role === 'ADMIN'
                                ? 'text-blue'
                                : 'text-ink-faint',
                          )}
                        >
                          {ROLE_LABEL[m.role]}
                        </span>
                      </div>
                    </div>

                    {!isSelf && myRole === 'OWNER' && m.role !== 'OWNER' && (
                      <button
                        type="button"
                        onClick={() =>
                          setRole.mutate({
                            userId: m.userId,
                            role: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                          })
                        }
                        disabled={setRole.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-blue/10 hover:text-blue disabled:opacity-50"
                        title={m.role === 'ADMIN' ? 'Adminlikdan olish' : 'Admin qilish'}
                      >
                        {m.role === 'ADMIN' ? (
                          <ShieldOff className="h-4 w-4" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    {!isSelf &&
                      canManage &&
                      m.role !== 'OWNER' &&
                      (myRole === 'OWNER' || m.role !== 'ADMIN') && (
                        <button
                          type="button"
                          onClick={() => removeMember.mutate(m.userId)}
                          disabled={removeMember.isPending}
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-red/10 hover:text-red disabled:opacity-50"
                          title="Guruhdan chiqarish"
                        >
                          <UserMinus className="h-4 w-4" />
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {myRole && myRole !== 'OWNER' && (
          <div className="border-t border-rim px-6 py-4">
            <button
              type="button"
              onClick={() => leaveGroup.mutate()}
              disabled={leaveGroup.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red/20 bg-red-tint px-4 py-2.5 text-xs font-bold text-red transition-all hover:bg-red/10 active:scale-[0.98] disabled:opacity-60"
            >
              {leaveGroup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Guruhdan chiqish
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
