'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { t } from '@/lib/strings.vi';
import { type MenuResults, searchMenu } from './search-action';

const EMPTY: MenuResults = { ads: [], shops: [], keywords: [], ideas: [], screens: [] };

/** Ctrl+K (⌘K on a Mac) over ads, shops, keywords, saved ideas and the screens the user may open (spec §6). */
export function CommandMenu({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MenuResults>(EMPTY);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults(EMPTY);
      return;
    }
    const id = setTimeout(() => startTransition(async () => setResults(await searchMenu(query))), 150);
    return () => clearTimeout(id);
  }, [query, isAdmin]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-surface border-line text-fg-2 rounded-control flex h-9 w-64 items-center gap-2 border px-3 text-[13px] mobile:w-auto"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left mobile:sr-only">{t.search.open}</span>
        <kbd className="text-fg-muted text-[11px] mobile:hidden">{t.search.shortcut}</kbd>
      </button>
      {/* cmdk filters by itself; the server already filtered and ranked, so its filter is off. */}
      <CommandDialog open={open} onOpenChange={setOpen} title={t.search.open} description={t.search.hint} shouldFilter={false}>
        <CommandInput placeholder={t.search.placeholder} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{query.trim().length < 3 ? t.search.hint : t.search.empty}</CommandEmpty>
          {results.ads.length ? (
            <CommandGroup heading={t.search.groupAds}>
              {results.ads.map((a) => (
                <CommandItem key={a.adArchiveId} value={`ad:${a.adArchiveId}`} onSelect={() => go(`/ads/${a.adArchiveId}`)}>
                  <span className="truncate">{a.caption ?? a.adArchiveId}</span>
                  <span className="text-fg-2 ml-auto shrink-0 text-[12px]">{a.landingDomain ?? a.pageName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.shops.length ? (
            <CommandGroup heading={t.search.groupShops}>
              {results.shops.map((s) => (
                <CommandItem key={s.landingDomain} value={`shop:${s.landingDomain}`} onSelect={() => go(`/shops/${s.landingDomain}`)}>
                  {s.landingDomain}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.keywords.length ? (
            <CommandGroup heading={t.search.groupKeywords}>
              {results.keywords.map((k) => (
                <CommandItem key={k.id} value={`kw:${k.id}`} onSelect={() => go(`/keywords/${k.id}`)}>
                  {k.text}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.ideas.length ? (
            <CommandGroup heading={t.search.groupIdeas}>
              {results.ideas.map((i) => (
                <CommandItem key={i.id} value={`idea:${i.id}`} onSelect={() => go(`/ideas/${i.id}`)}>
                  <span className="truncate">{i.title}</span>
                  <span className="text-fg-2 ml-auto shrink-0 text-[12px]">{i.storeName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {results.screens.length ? (
            <CommandGroup heading={t.search.groupScreens}>
              {results.screens.map((s) => (
                <CommandItem key={s.href} value={`screen:${s.href}`} onSelect={() => go(s.href)}>
                  {s.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
