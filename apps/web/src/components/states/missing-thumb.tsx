import { ImageOff, Video } from 'lucide-react';
import { t } from '@/lib/strings.vi';
import { cn } from '@/lib/utils';

/** A gray tile instead of a broken image (spec §6 "Missing thumbnail"). */
export function MissingThumb({ mediaType, className }: { mediaType?: string | null; className?: string }) {
  const Icon = mediaType === 'video' ? Video : ImageOff;
  return (
    <div className={cn('bg-neutral-bg text-fg-2 flex flex-col items-center justify-center gap-1 text-xs', className)}>
      <Icon className="size-5" aria-hidden />
      <span>{t.states.missingThumb}</span>
    </div>
  );
}
