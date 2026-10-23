import {
  type LucideIcon,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  KeyRound,
  ListPlus,
  Lightbulb,
  ListChecks,
  Newspaper,
  Rss,
  Settings,
  Store,
  Tags,
  Users,
} from 'lucide-react';
import { t } from '@/lib/strings.vi';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const MAIN_NAV: NavItem[] = [
  { href: '/briefing', label: t.nav.briefing, icon: Newspaper },
  { href: '/ads', label: t.nav.ads, icon: BarChart3 },
  { href: '/shops', label: t.nav.shops, icon: Store },
  { href: '/keywords', label: t.nav.keywords, icon: Tags },
  { href: '/ideas', label: t.nav.ideas, icon: Lightbulb },
  { href: '/runs', label: t.nav.runs, icon: ListChecks },
];

/** Only for users with the `keywords` tick on the selected store (the layout decides). */
export const STORE_KEYWORDS_NAV: NavItem = { href: '/store-keywords', label: t.nav.storeKeywords, icon: ListPlus };

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/alerts', label: t.nav.alerts, icon: Bell },
  { href: '/admin/users', label: t.nav.users, icon: Users },
  { href: '/admin/stores', label: t.nav.stores, icon: KeyRound },
  { href: '/admin/keywords', label: t.nav.seedKeywords, icon: BookOpen },
  { href: '/admin/feeds', label: t.nav.feeds, icon: Rss },
  { href: '/admin/holidays', label: t.nav.holidays, icon: CalendarDays },
  { href: '/admin/settings', label: t.nav.settings, icon: Settings },
];
