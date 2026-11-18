'use client';
import Image from 'next/image';
import { Package } from 'lucide-react';
import { useState } from 'react';
export function ProductThumbnail({
  name,
  imageUrl,
  compact = false,
}: {
  name: string;
  imageUrl?: string | null;
  compact?: boolean;
}) {
  const size = compact ? 48 : 64;
  const dimensions = compact ? 'h-12 w-12' : 'h-16 w-16';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  let supported = false;
  if (imageUrl?.startsWith('/demo/products/')) supported = true;
  else if (imageUrl) {
    try {
      const url = new URL(imageUrl);
      supported = url.protocol === 'https:' && url.hostname === 'images.unsplash.com';
    } catch {
      supported = false;
    }
  }
  if (!supported || failedSrc === imageUrl)
    return (
      <div
        aria-label={`${name}暂无图片`}
        className={`${dimensions} grid shrink-0 place-items-center rounded-xl border border-line bg-sunken text-[10px] text-ink-faint`}
      >
        <Package size={22} strokeWidth={1.5} />
      </div>
    );
  return (
    <Image
      src={imageUrl!}
      alt={`${name}商品图`}
      width={size}
      height={size}
      className={`${dimensions} shrink-0 rounded-xl border border-line bg-surface p-1 object-contain`}
      sizes={`${size}px`}
      onError={() => setFailedSrc(imageUrl || null)}
    />
  );
}
