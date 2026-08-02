'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Share2, Loader2, CheckCircle2 } from 'lucide-react';
import { enrollmentApi } from '../../lib/api/enrollment';

interface InviteLinkButtonProps {
  groupId: string;
}

export function InviteLinkButton({ groupId }: InviteLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  
  const createInvite = useMutation({
    mutationFn: () => enrollmentApi.createInviteLink({ groupId }),
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
  });

  return (
    <button
      onClick={() => createInvite.mutate()}
      disabled={createInvite.isPending}
      className="inline-flex h-11 items-center gap-2 rounded-2xl border border-rim bg-white px-5 text-sm font-bold text-ink-strong shadow-sm transition-all hover:bg-tint hover:border-blue/20 active:scale-[0.98] disabled:opacity-50"
    >
      {createInvite.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : copied ? (
        <CheckCircle2 className="h-4 w-4 text-teal" />
      ) : (
        <Share2 className="h-4 w-4 text-blue" />
      )}
      {copied ? 'Nusxalandi' : 'Taklif havolasi'}
    </button>
  );
}
