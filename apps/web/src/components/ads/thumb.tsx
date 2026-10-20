'use client';

import Image from 'next/image';
import { useState } from 'react';
import { MissingThumb } from '@/components/states/missing-thumb';
import { cn } from '@/lib/utils';

/**
 * An ad thumbnail through next/image from its signed `/thumbs/…` URL, 320 px wide (640 at 2x), lazy
 * unless `priority`; the "Chưa có ảnh" tile when there is none or it fails to load (plan Step 6).
 */
export function Thumb({ src, mediaType, alt, priority, className }: { src: string | null; mediaType?: string | null; alt: string; priority?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <MissingThumb mediaType={mediaType} className={cn('aspect-square w-full', className)} />;
  return (
    <Image
      src={src}
      alt={alt}
      width={320}
      height={320}
      priority={priority}
      onError={() => setFailed(true)}
      className={cn('bg-neutral-bg aspect-square w-full object-cover', className)}
    />
  );
}
