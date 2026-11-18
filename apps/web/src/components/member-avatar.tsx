'use client';
import Image from 'next/image';
import { useState } from 'react';

export function MemberAvatar({
  name,
  src,
  compact = false,
}: {
  name: string;
  src?: string | null;
  compact?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const size = compact ? 32 : 40;
  const className =
    (compact ? 'h-8 w-8' : 'h-10 w-10') + ' shrink-0 rounded-full border border-line bg-sunken';
  return src?.startsWith('/demo/avatars/') && failedSrc !== src ? (
    <Image
      src={src}
      alt={`${name}头像`}
      width={size}
      height={size}
      unoptimized
      className={className + ' object-cover'}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      aria-label={`${name}默认头像`}
      className={className + ' grid place-items-center font-medium text-brand'}
    >
      {name.slice(0, 1)}
    </span>
  );
}
